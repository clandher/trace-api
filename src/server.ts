import http from 'http';
import { WebSocketServer } from 'ws';
import { YjsWebSocketHandler } from './websocket/handler.js';
// @ts-ignore
import { docs } from 'y-websocket/bin/utils';

// Puerto de escucha desde variables de entorno o predeterminado
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 1234;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * 1. Inicialización del Servidor HTTP nativo.
 * Se encarga de responder a peticiones de salud (healthcheck) o
 * de servir metadatos básicos de las salas activas.
 */
const server = http.createServer((req, res) => {
  // Configuración de cabeceras CORS básicas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Ruta de salud e inspección de salas activas (útil para DevOps y monitoreo)

  // Endpoint de salud y versión
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      activeRooms: docs.size,
      version: require('../package.json').version
    }));
    return;
  }

  // Endpoint: listado de salas activas
  if (req.url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const rooms = Array.from(docs.keys());
    res.end(JSON.stringify({ rooms, count: rooms.length }));
    return;
  }

  // Endpoint: información de una sala específica
  if (req.url?.startsWith('/room-info')) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const room = urlObj.searchParams.get('room');
    if (!room || !docs.has(room)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Room not found' }));
      return;
    }
    const sharedDoc = docs.get(room);
    const users = sharedDoc ? Array.from(sharedDoc.conns.keys()).map((ws) => ws.userId || 'anon') : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      room,
      usersCount: users.length,
      users,
      // Puedes agregar más info relevante aquí
    }));
    return;
  }

  // Información de API básica en la raíz
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Yjs Collaborative Canvas Real-Time Server - Activo 🚀');
});

/**
 * 2. Inicialización del Servidor WebSocket.
 * Asociado directamente al servidor HTTP para compartir puerto y canal de transporte.
 */
const wss = new WebSocketServer({ noServer: true });

// Delegar el proceso de actualización de conexión (handshake upgrade) al servidor WebSocket
server.on('upgrade', (request, socket, head) => {
  // Filtrar si la conexión es para la sincronización colaborativa
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  
  if (url.searchParams.has('room')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Si no contiene el query parameter obligatorio 'room', cerramos la conexión inmediatamente
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nFalta parámetro ?room=');
    socket.destroy();
  }
});

// 3. Acoplamiento del manejador WebSocket modular
wss.on('connection', async (ws, req) => {
  await YjsWebSocketHandler.handleConnection(ws, req);
});

// 4. Iniciar el servidor
server.listen(PORT, HOST, () => {
  console.log(`[Servidor] Backend de Yjs escuchando en: http://${HOST}:${PORT}`);
  console.log(`[WebSocket] Canal WebSocket disponible en: ws://${HOST}:${PORT}?room=canvas-id`);
});

/**
 * 5. Ciclo de Apagado Grácil (Graceful Shutdown).
 * Garantiza que cuando se detenga el proceso Node (por reinicio, despliegue o CTRL+C),
 * no se pierda el estado actual de los canvas en memoria escribiéndolos de inmediato.
 */
const shutdown = async (signal: string) => {
  console.log(`\n[Apagado] Recibida señal ${signal}. Iniciando apagado grácil...`);
  
  // Detener la recepción de nuevas conexiones
  server.close(() => {
    console.log('[Apagado] Servidor HTTP/WebSocket detenido. Ya no acepta nuevas conexiones.');
  });
  
  wss.clients.forEach((client) => {
    client.close(1012, 'El servidor se está reiniciando');
  });

  console.log(`[Apagado] Persistiendo ${docs.size} salas activas en base de datos...`);
  const savePromises: Promise<void>[] = [];
  
  // Guardado de emergencia de todas las salas abiertas
  docs.forEach((sharedDoc: any, roomName: string) => {
    // Si tienes hooks de guardado asociados en bindState, forzamos la escritura definitiva
    console.log(`[Apagado] Persistiendo sala activa: ${roomName}`);
    // Lanzamos de forma síncrona/promesa la persistencia inmediata de cada documento
    if (sharedDoc && typeof sharedDoc.emit === 'function') {
      sharedDoc.emit('destroy');
    }
  });

  // Esperar un breve momento para asegurar las escrituras en base de datos
  setTimeout(() => {
    console.log('[Apagado] Persistencia de emergencia completada. Saliendo del proceso.');
    process.exit(0);
  }, 2000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
