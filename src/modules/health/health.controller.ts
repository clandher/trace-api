// HealthController: Endpoints de health y status
import { IncomingMessage, ServerResponse } from 'http';
// import { docs } from 'y-websocket/bin/utils';
// import { version } from '../../../package.json';

export class HealthController {
  // static health(_req: IncomingMessage, res: ServerResponse) {
  //   res.writeHead(200, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify({
  //     status: 'ok',
  //     uptime: process.uptime(),
  //     activeRooms: docs.size,
  //     version,
  //   }));
  // }

  // static rooms(_req: IncomingMessage, res: ServerResponse) {
  //   const rooms = Array.from(docs.keys());
  //   res.writeHead(200, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify({ rooms, count: rooms.length }));
  // }

  // static roomInfo(req: IncomingMessage, res: ServerResponse) {
  //   const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
  //   const room = urlObj.searchParams.get('room');
  //   if (!room || !docs.has(room)) {
  //     res.writeHead(404, { 'Content-Type': 'application/json' });
  //     res.end(JSON.stringify({ error: 'Room not found' }));
  //     return;
  //   }
  //   res.writeHead(200, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify({ room }));
  // }
}
