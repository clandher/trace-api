import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
// @ts-ignore
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { AuthService } from '../auth/auth.service.js';
import { RoomsProvider } from '../rooms/rooms.provider.js';

const _require = createRequire(import.meta.url);
const Y = _require('yjs');

// Persist Yjs state to disk so it survives server restarts during dev.
const PERSIST_DIR = join(process.cwd(), '.yjs-state');
if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });

function stateFilePath(docname: string): string {
  return join(PERSIST_DIR, `${docname.replace(/[^a-zA-Z0-9-_]/g, '_')}.bin`);
}

// In-memory cache so we don't hit the filesystem on every update.
const storage = new Map<string, Uint8Array>();

setPersistence({
  bindState: async (docname: string, ydoc: any) => {
    const file = stateFilePath(docname);
    if (!storage.has(docname) && existsSync(file)) {
      storage.set(docname, new Uint8Array(readFileSync(file)));
    }
    const state = storage.get(docname);
    if (state) Y.applyUpdate(ydoc, state);
    ydoc.on('update', () => {
      const encoded = Y.encodeStateAsUpdate(ydoc);
      storage.set(docname, encoded);
      try { writeFileSync(file, encoded); } catch { /* non-fatal */ }
    });
  },
  writeState: async (docname: string, ydoc: any) => {
    const encoded = Y.encodeStateAsUpdate(ydoc);
    storage.set(docname, encoded);
    try { writeFileSync(stateFilePath(docname), encoded); } catch { /* non-fatal */ }
  },
});

const wsUserMap: WeakMap<WebSocket, string> = new WeakMap();

export class WebsocketGateway {
  static async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const room = url.searchParams.get('room');
      const token = url.searchParams.get('token');
      console.log('[WS] connection attempt — room:', room, '| token present:', !!token);
      if (!room) {
        console.warn('[WS] rejected 4001 — missing room param');
        ws.close(4001, 'Falta el parámetro "room" en la URL (?room=canvas-id)');
        return;
      }
      const userId = token ? await AuthService.verifySupabaseJWT(token) : null;
      console.log('[WS] JWT verify result — userId:', userId);
      if (!userId) {
        console.warn('[WS] rejected 4002 — invalid token');
        ws.close(4002, 'Token inválido');
        return;
      }
      const allowed = await RoomsProvider.isUserAllowed(room, userId, token!);
      console.log('[WS] isUserAllowed:', allowed);
      if (!allowed) {
        console.warn('[WS] rejected 4003 — not authorized');
        ws.close(4003, 'No autorizado para acceder a esta sala');
        return;
      }
      wsUserMap.set(ws, userId);
      setupWSConnection(ws, req, { docName: room });
    } catch (err) {
      console.error('[WS] internal error:', err);
      ws.close(1011, 'Error interno');
    }
  }
}
