// @ts-nocheck
// Local port of y-websocket@2.x bin/utils.js.
// Re-exposes server helpers (setupWSConnection, setPersistence, docs)
// that were removed from y-websocket@3 package exports.
// Original: https://github.com/yjs/y-websocket (MIT, Kevin Jahns).

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0';

let persistence: {
  bindState: (docName: string, ydoc: WSSharedDoc) => void | Promise<void>;
  writeState: (docName: string, ydoc: WSSharedDoc) => Promise<any>;
} | null = null;

export const setPersistence = (persistence_: typeof persistence) => {
  persistence = persistence_;
};

export const getPersistence = () => persistence;

export const docs: Map<string, WSSharedDoc> = new Map();

const messageSync = 0;
const messageAwareness = 1;

const updateHandler = (update: Uint8Array, _origin: any, doc: WSSharedDoc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

export class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<any, Set<number>>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super({ gc: gcEnabled });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      conn: any,
    ) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => connControlledIDs.add(clientID));
          removed.forEach((clientID) => connControlledIDs.delete(clientID));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, buff));
    };
    this.awareness.on('update', awarenessChangeHandler);
    this.on('update', updateHandler);
  }
}

export const getYDoc = async (docname: string, gc = true): Promise<WSSharedDoc> => {
  let doc = docs.get(docname);
  if (!doc) {
    doc = new WSSharedDoc(docname);
    doc.gc = gc;
    docs.set(docname, doc);
    if (persistence !== null) {
      await persistence.bindState(docname, doc);
    }
  }
  return doc;
};

const messageListener = (conn: any, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
    }
  } catch (err) {
    console.error(err);
    doc.emit('error', [err]);
  }
};

const closeConn = (doc: WSSharedDoc, conn: any, reason: string = 'unknown') => {
  if (doc.conns.has(conn)) {
    const meta = (conn as any).__connMeta;
    const elapsed = meta ? Date.now() - meta.openedAt : -1;
    console.log('[WS] close —', reason, '| room:', doc.name.slice(0, 8), '| user:', meta?.userTag ?? '?', '| elapsedMs:', elapsed, '| remaining conns:', doc.conns.size - 1);
    const controlledIds = doc.conns.get(conn)!;
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds),
      null,
    );
    if (doc.conns.size === 0 && persistence !== null) {
      persistence.writeState(doc.name, doc).then(() => doc.destroy());
      docs.delete(doc.name);
    }
  }
  conn.close();
};

const send = (doc: WSSharedDoc, conn: any, m: Uint8Array) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn, 'send-bad-readyState');
  }
  try {
    conn.send(m, (err: any) => {
      if (err != null) closeConn(doc, conn, 'send-callback-error: ' + (err?.message ?? err));
    });
  } catch (e: any) {
    closeConn(doc, conn, 'send-throw: ' + (e?.message ?? e));
  }
};

const pingTimeout = 30000;

export const setupWSConnection = async (
  conn: any,
  req: any,
  { docName = (req.url || '').slice(1).split('?')[0], gc = true, userTag = '?' }: { docName?: string; gc?: boolean; userTag?: string } = {},
) => {
  conn.binaryType = 'arraybuffer';
  const doc = await getYDoc(docName, gc);
  doc.conns.set(conn, new Set());
  (conn as any).__connMeta = { openedAt: Date.now(), userTag };
  console.log('[WS] open — room:', docName.slice(0, 8), '| user:', userTag, '| total conns:', doc.conns.size);

  conn.on('message', (message: ArrayBuffer) =>
    messageListener(conn, doc, new Uint8Array(message)),
  );

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn, 'ping-timeout-no-pong');
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (e: any) {
        closeConn(doc, conn, 'ping-throw: ' + (e?.message ?? e));
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);

  conn.on('close', (code: number, reasonBuf: Buffer) => {
    const reason = reasonBuf?.toString?.() || '';
    closeConn(doc, conn, `client-close code=${code} reason="${reason}"`);
    clearInterval(pingInterval);
  });
  conn.on('error', (err: any) => {
    closeConn(doc, conn, 'ws-error: ' + (err?.message ?? err));
    clearInterval(pingInterval);
  });
  conn.on('pong', () => {
    pongReceived = true;
  });

  // initial sync — send sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));

    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder2 = encoding.createEncoder();
      encoding.writeVarUint(encoder2, messageAwareness);
      encoding.writeVarUint8Array(
        encoder2,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      send(doc, conn, encoding.toUint8Array(encoder2));
    }
  }
};
