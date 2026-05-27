import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { setupWSConnection, setPersistence, docs } from '../../lib/y-websocket-utils.js';
import { AuthService } from '../auth/auth.service.js';
import { RoomsProvider } from '../rooms/rooms.provider.js';
import { config } from '../../config/index.js';

const _require = createRequire(import.meta.url);
const Y = _require('yjs');

// Diagnostic — confirms what key is loaded (prefix only).
console.log('[Yjs persist] SUPABASE_SERVICE_ROLE_KEY prefix:', config.SUPABASE_SERVICE_ROLE_KEY.slice(0, 16), '| length:', config.SUPABASE_SERVICE_ROLE_KEY.length);

// Custom fetch wrapper logs outbound Supabase headers so we can see exactly
// what PostgREST receives. Strip key values for the log; only show presence.
const loggingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
  const headers = new Headers(init?.headers as any);
  const apikey = headers.get('apikey');
  const auth = headers.get('Authorization');
  if (url.includes('/rest/v1/rooms')) {
    console.log('[Yjs persist] HTTP', init?.method ?? 'GET', url);
    console.log('  apikey present:', !!apikey, '| prefix:', apikey?.slice(0, 10));
    console.log('  Authorization:', auth ? (auth.slice(0, 17) + '... | full prefix matches apikey: ' + (auth === `Bearer ${apikey}`)) : 'NONE');
  }
  return fetch(input, init);
};

// Server-role Supabase client for Yjs state persistence. Bypasses RLS.
const supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: loggingFetch },
});

// In-memory cache so we don't hit the database on every update.
const storage = new Map<string, Uint8Array>();
// Debounced write timers per room to avoid hammering Postgres on rapid edits.
const writeTimers = new Map<string, NodeJS.Timeout>();
const WRITE_DEBOUNCE_MS = 1500;

const persistToDb = async (docname: string, state: Uint8Array): Promise<void> => {
  const encoded = Buffer.from(state).toString('base64');
  console.log('[Yjs persist] writing — room:', docname, '| bytes:', state.length, '| base64 len:', encoded.length);

  // Diagnostic: does the admin client see this row at all?
  const probe = await supabaseAdmin.from('rooms').select('id, host_user_id').eq('id', docname);
  console.log('[Yjs persist] probe SELECT result — rows:', probe.data?.length ?? 0, '| error:', probe.error?.message ?? 'none');

  const { data, error, status } = await supabaseAdmin
    .from('rooms')
    .update({ yjs_state: encoded })
    .eq('id', docname)
    .select('id');
  if (error) {
    console.error('[Yjs persist] update failed for', docname, '| status:', status, '| error:', error.message, '| details:', error.details);
  } else if (!data || data.length === 0) {
    console.warn('[Yjs persist] update affected 0 rows for', docname, '— check RLS, probe result above');
  } else {
    console.log('[Yjs persist] saved OK — room:', docname);
  }
};

const scheduleWrite = (docname: string, state: Uint8Array): void => {
  const existing = writeTimers.get(docname);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    writeTimers.delete(docname);
    persistToDb(docname, state).catch(err => console.error('[Yjs persist] error:', err));
  }, WRITE_DEBOUNCE_MS);
  writeTimers.set(docname, timer);
};

setPersistence({
  bindState: async (docname: string, ydoc: any) => {
    console.log('[Yjs persist] bindState — room:', docname);
    // Register update listener FIRST so we don't miss updates that arrive
    // while we're awaiting the initial DB load.
    ydoc.on('update', () => {
      const encoded = Y.encodeStateAsUpdate(ydoc);
      storage.set(docname, encoded);
      console.log('[Yjs persist] ydoc update — scheduling write for', docname);
      scheduleWrite(docname, encoded);
    });

    if (!storage.has(docname)) {
      const { data, error } = await supabaseAdmin
        .from('rooms')
        .select('yjs_state')
        .eq('id', docname)
        .single();
      if (error) {
        console.warn('[Yjs persist] load failed for', docname, '| error:', error.message);
      } else if (data?.yjs_state) {
        try {
          storage.set(docname, new Uint8Array(Buffer.from(data.yjs_state, 'base64')));
          console.log('[Yjs persist] loaded from DB — room:', docname, '| bytes:', storage.get(docname)!.length);
        } catch (err) {
          console.error('[Yjs persist] decode failed for', docname, err);
        }
      } else {
        console.log('[Yjs persist] no stored state for room:', docname, '(fresh)');
      }
    }
    const state = storage.get(docname);
    if (state) Y.applyUpdate(ydoc, state);
  },
  writeState: async (docname: string, ydoc: any) => {
    const encoded = Y.encodeStateAsUpdate(ydoc);
    storage.set(docname, encoded);
    const pending = writeTimers.get(docname);
    if (pending) {
      clearTimeout(pending);
      writeTimers.delete(docname);
    }
    console.log('[Yjs persist] writeState (flush) — room:', docname);
    await persistToDb(docname, encoded);
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
      // Diagnostic: report doc state on every connection so we can see
      // if server has data when a client connects/reconnects.
      const doc = (docs as Map<string, any>).get(room);
      if (doc) {
        const shapes = doc.getMap('shapes').size;
        const nodes = doc.getMap('nodes').size;
        const connections = doc.getMap('connections').size;
        console.log('[WS] doc state — room:', room, '| conns:', doc.conns.size, '| shapes:', shapes, '| nodes:', nodes, '| connections:', connections);
      }
    } catch (err) {
      console.error('[WS] internal error:', err);
      ws.close(1011, 'Error interno');
    }
  }
}
