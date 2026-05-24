import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { createRequire } from 'module';
// @ts-ignore
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { AuthService } from '../auth/auth.service.js';
import { RoomsProvider } from '../rooms/rooms.provider.js';

// Use CJS require so Yjs is the same instance as y-websocket/bin/utils — avoids
// the "Yjs was already imported" dual-instance warning that breaks CRDT sync.
const _require = createRequire(import.meta.url);
const Y = _require('yjs');

const storage = new Map<string, Uint8Array>();

setPersistence({
  bindState: async (docname: string, ydoc: any) => {
    const state = storage.get(docname);
    if (state) Y.applyUpdate(ydoc, state);
    ydoc.on('update', () => {
      storage.set(docname, Y.encodeStateAsUpdate(ydoc));
    });
  },
  writeState: async (docname: string, ydoc: any) => {
    storage.set(docname, Y.encodeStateAsUpdate(ydoc));
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
