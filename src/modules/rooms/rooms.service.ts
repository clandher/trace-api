// RoomsService: Lógica de negocio para rooms
import { docs } from '../../lib/y-websocket-utils.js';

export class RoomsService {
  getActiveRooms() {
    const rooms = Array.from(docs.keys());
    return { rooms, count: rooms.length };
  }

  getRoomInfo(room?: string | null) {
    if (!room || !docs.has(room)) return null;
    const sharedDoc = docs.get(room);
    const users = sharedDoc ? Array.from(sharedDoc.conns.keys()).map((ws: any) => ws.userId || 'anon') : [];
    return {
      room,
      usersCount: users.length,
      users,
    };
  }
}
