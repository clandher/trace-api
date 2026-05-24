// RoomsController: Encargado de endpoints HTTP relacionados a rooms
import { IncomingMessage, ServerResponse } from 'http';
import { RoomsService } from './rooms.service.js';

const roomsService = new RoomsService();

export class RoomsController {
  static list(req: IncomingMessage, res: ServerResponse) {
    const { rooms, count } = roomsService.getActiveRooms();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms, count }));
  }

  static info(req: IncomingMessage, res: ServerResponse) {
    const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
    const room = urlObj.searchParams.get('room');
    const info = roomsService.getRoomInfo(room);
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Room not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
  }
}
