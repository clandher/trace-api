// WebsocketGateway: Encargado del ciclo de vida de conexiones WebSocket
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
// @ts-ignore
import { setupWSConnection, docs } from 'y-websocket/bin/utils';
import { MemoryPersistenceProvider } from '../database/persistence.provider.js';
import { AuthService } from '../auth/auth.service.js';
import { RoomsProvider } from '../rooms/rooms.provider.js';

const wsUserMap: WeakMap<WebSocket, string> = new WeakMap();
const persistenceProvider = new MemoryPersistenceProvider();

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
        ws.close(4002, 'Token inválido');
        return;
      }
      const allowed = await RoomsProvider.isUserAllowed(room, userId);
      if (!allowed) {
        ws.close(4003, 'No autorizado para acceder a esta sala');
        return;
      }
      wsUserMap.set(ws, userId);
      // Acoplar Yjs y persistencia
      if (!docs.has(room)) {
        const doc = new Y.Doc();
        await persistenceProvider.bindState(room, doc);
        docs.set(room, doc);
      }
      setupWSConnection(ws, req, { docName: room });
    } catch (err) {
      ws.close(1011, 'Error interno');
    }
  }
}
