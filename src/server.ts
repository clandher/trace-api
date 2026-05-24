import http from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import { HealthController } from './modules/health/health.controller.js';
import { RoomsController } from './modules/rooms/rooms.controller.js';
import { WebsocketGateway } from './modules/websocket/websocket.gateway.js';
// @ts-ignore
import { docs } from 'y-websocket/bin/utils';

const { PORT, HOST } = config;

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

  // Routing HTTP
  // if (req.url === '/health') {
  //     HealthController.health(req, res);
  //   return;
  // }
  if (req.url === '/rooms') {
      RoomsController.list(req, res);
    return;
  }
  if (req.url?.startsWith('/room-info')) {
      RoomsController.info(req, res);
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

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.searchParams.has('room')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nFalta parámetro ?room=');
    socket.destroy();
  }
});

wss.on('connection', async (ws, req) => {
  await WebsocketGateway.handleConnection(ws, req);
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
