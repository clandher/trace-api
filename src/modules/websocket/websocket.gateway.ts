import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createClient } from '@supabase/supabase-js';
import { setupWSConnection, setPersistence } from '../../lib/y-websocket-utils.js';
import { AuthService } from '../auth/auth.service.js';
import { RoomsProvider } from '../rooms/rooms.provider.js';
import { config } from '../../config/index.js';

// Diagnostic — confirms what key is loaded (prefix only).
console.log('[Yjs persist] SUPABASE_SERVICE_ROLE_KEY prefix:', config.SUPABASE_SERVICE_ROLE_KEY.slice(0, 16), '| length:', config.SUPABASE_SERVICE_ROLE_KEY.length);

// Server-role Supabase client for Yjs state persistence. Bypasses RLS.
const supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

// In-memory cache so we don't hit the database on every update.
const storage = new Map<string, Uint8Array>();
// Debounced write timers per room to avoid hammering Postgres on rapid edits.
const writeTimers = new Map<string, NodeJS.Timeout>();
const WRITE_DEBOUNCE_MS = 1500;

const persistToDb = async (docname: string, state: Uint8Array): Promise<void> => {
  const encoded = Buffer.from(state).toString('base64');
  const { data, error, status } = await supabaseAdmin
    .from('rooms')
    .update({ yjs_state: encoded })
    .eq('id', docname)
    .select('id');
  if (error) {
    console.error('[Yjs persist] update failed —', docname.slice(0, 8), '| status:', status, '| error:', error.message);
  } else if (!data || data.length === 0) {
    console.warn('[Yjs persist] 0 rows updated —', docname.slice(0, 8));
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
    // Register update listener FIRST so we don't miss updates that arrive
    // while we're awaiting the initial DB load.
    ydoc.on('update', () => {
      const encoded = Y.encodeStateAsUpdate(ydoc);
      storage.set(docname, encoded);
      scheduleWrite(docname, encoded);
    });

    if (!storage.has(docname)) {
      const { data, error } = await supabaseAdmin
        .from('rooms')
        .select('yjs_state')
        .eq('id', docname)
        .single();
      if (error) {
        console.warn('[Yjs persist] load failed —', docname.slice(0, 8), '| error:', error.message);
      } else if (data?.yjs_state) {
        try {
          storage.set(docname, new Uint8Array(Buffer.from(data.yjs_state, 'base64')));
        } catch (err) {
          console.error('[Yjs persist] decode failed —', docname.slice(0, 8), err);
        }
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
      if (!room) {
        ws.close(4001, 'Falta el parámetro "room" en la URL (?room=canvas-id)');
        return;
      }
      const userId = token ? await AuthService.verifySupabaseJWT(token) : null;
      if (!userId) {
        console.warn('[WS] reject 4002 — room:', room.slice(0, 8), '| token len:', token?.length ?? 0);
        // Proxies (Render) strip custom close codes 4000-4999. Send payload
        // message first so client can detect auth error even when code is lost.
        try { ws.send(JSON.stringify({ type: 'auth_error', code: 4002, message: 'Token inválido' })); } catch {}
        ws.close(1008, 'Token inválido');
        return;
      }
      const userTag = userId.slice(0, 6);
      const allowed = await RoomsProvider.isUserAllowed(room, userId, token!);
      if (!allowed) {
        console.warn('[WS] reject 4003 — room:', room.slice(0, 8), '| user:', userTag);
        try { ws.send(JSON.stringify({ type: 'auth_error', code: 4003, message: 'No autorizado para acceder a esta sala' })); } catch {}
        ws.close(1008, 'No autorizado para acceder a esta sala');
        return;
      }
      wsUserMap.set(ws, userId);
      await setupWSConnection(ws, req, { docName: room, userTag });
    } catch (err: any) {
      console.error('[WS] handleConnection threw:', err?.message ?? err);
      ws.close(1011, 'Error interno');
    }
  }
}
