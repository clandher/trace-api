import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
// @ts-ignore
import { setupWSConnection, docs } from 'y-websocket/bin/utils';
import { IPersistenceProvider, MemoryPersistenceProvider } from '../database/persistence.js';

// Instanciamos el proveedor de persistencia elegido. Por defecto iniciamos con Memory (Desarrollo).
// En producción, se cambiaría por new MongoPersistenceProvider(...) o RedisPersistenceProvider(...)
const persistenceProvider: IPersistenceProvider = new MemoryPersistenceProvider();

/**
 * Gestor de salas y ciclo de vida de conexiones WebSocket para Yjs.
 */
export class YjsWebSocketHandler {
  
  /**
   * Maneja una nueva conexión WebSocket entrante.
   * Realiza validación de salas, autenticación de tokens y acoplamiento con Yjs.
   */
  public static async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      // 1. Extraer parámetros de la URL
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const room = url.searchParams.get('room');
      const token = url.searchParams.get('token'); // Hook de Autenticación listo para usar

      console.log(`[WebSocket] Nueva solicitud de conexión. Sala: ${room}, Token: ${token ? 'Proporcionado' : 'Ninguno'}`);

      // 2. Validación de la sala
      if (!room) {
        console.warn('[WebSocket] Conexión rechazada: Falta el parámetro "room"');
        ws.close(4001, 'Falta el parámetro "room" en la URL (?room=canvas-id)');
        return;
      }

      // 3. Hook de Autenticación (Punto de validación clave con el cliente)
      const isAuthenticated = await this.authenticate(token, room);
      if (!isAuthenticated) {
        console.warn(`[WebSocket] Conexión rechazada: Token no válido para la sala ${room}`);
        ws.close(4002, 'No autorizado para acceder a esta sala');
        return;
      }

      // 4. Obtener o crear el documento compartido (Y.Doc) para la sala
      // El mapa `docs` proviene de y-websocket/bin/utils.js y mantiene las salas activas en memoria
      const isNewRoom = !docs.has(room);
      
      // setupWSConnection se encarga de acoplar el WebSocket con el protocolo Yjs
      // Si la sala no existía previamente, Yjs crea un nuevo WSSharedDoc.

      // --- Extensión: utilidades custom para el cliente ---
      // Asignar un userId temporal (puedes mejorar esto con autenticación real)
      ws.userId = url.searchParams.get('user') || `anon-${Math.floor(Math.random()*10000)}`;

      // Handler de mensajes custom
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        // Utilidad: users in room
        if (msg.type === 'users_in_room') {
          const sharedDoc = docs.get(room);
          const users = sharedDoc ? Array.from(sharedDoc.conns.keys()).map((ws) => ws.userId || 'anon') : [];
          ws.send(JSON.stringify({ type: 'users_in_room', users }));
        }
        // Utilidad: user info
        if (msg.type === 'user_info') {
          ws.send(JSON.stringify({ type: 'user_info', userId: ws.userId }));
        }
        // Utilidad: permissions (ejemplo simple)
        if (msg.type === 'permissions') {
          // Aquí puedes consultar permisos reales según tu lógica
          ws.send(JSON.stringify({ type: 'permissions', permissions: ['read', 'write'] }));
        }
        // Utilidad: room info (detalles de la sala y usuarios)
        if (msg.type === 'room_info') {
          const sharedDoc = docs.get(room);
          if (sharedDoc) {
            const users = Array.from(sharedDoc.conns.keys()).map((ws) => ws.userId || 'anon');
            ws.send(JSON.stringify({
              type: 'room_info',
              room,
              usersCount: users.length,
              users
            }));
          } else {
            ws.send(JSON.stringify({ type: 'room_info', error: 'Room not found' }));
          }
        }
        // Utilidad: typing indicator (broadcast a la sala)
        if (msg.type === 'typing') {
          const sharedDoc = docs.get(room);
          if (sharedDoc) {
            for (const client of sharedDoc.conns.keys()) {
              if (client !== ws) {
                client.send(JSON.stringify({ type: 'typing', userId: ws.userId, isTyping: msg.isTyping }));
              }
            }
          }
        }
      });

      setupWSConnection(ws, req, {
        docName: room,
        gc: true // Garbage collection habilitado para limpiar estados borrados de Yjs y ahorrar memoria
      });

      // 5. Vincular Persistencia si la sala es nueva
      if (isNewRoom) {
        console.log(`[WebSocket] Sala '${room}' es nueva en este nodo. Inicializando persistencia...`);
        const sharedDoc = docs.get(room);
        
        if (sharedDoc) {
          // Vinculamos el documento al proveedor de base de datos
          await persistenceProvider.bindState(room, sharedDoc);
          
          // Registrar hook de limpieza al destruirse la sala
          sharedDoc.on('destroy', async () => {
            console.log(`[WebSocket] Sala '${room}' destruida en memoria. Ejecutando persistencia final...`);
            await persistenceProvider.saveState(room, sharedDoc);
          });
        }
      }

      // 6. Hook de Desconexión / Monitoreo de sala vacía
      ws.on('close', async (code, reason) => {
        console.log(`[WebSocket] Cliente desconectado de la sala '${room}'. Código: ${code}, Razón: ${reason}`);
        
        // Verificamos si la sala se ha quedado vacía en este servidor
        const sharedDoc = docs.get(room);
        if (sharedDoc) {
          // El WSSharedDoc mantiene las conexiones en la propiedad 'conns' (un Map de WebSocket -> Set)
          const connectionCount = sharedDoc.conns.size;
          console.log(`[WebSocket] Conexiones activas restantes en la sala '${room}': ${connectionCount}`);
          
          if (connectionCount === 0) {
            console.log(`[WebSocket] La sala '${room}' está vacía. Persistiendo estado final y liberando memoria.`);
            
            // Forzar guardado inmediato en DB
            await persistenceProvider.saveState(room, sharedDoc);
            
            // Destruimos el documento de memoria para evitar fugas (fugas de memoria)
            sharedDoc.destroy();
            docs.delete(room);
          }
        }
      });

    } catch (error) {
      console.error('[WebSocket] Error crítico manejando conexión:', error);
      ws.close(1011, 'Error interno del servidor');
    }
  }

  /**
   * Validador de tokens de autenticación para WebSockets.
   * Modificar este método para integrar JWT, OAuth o sesión de tu base de datos.
   */
  private static async authenticate(token: string | null, room: string): Promise<boolean> {
    // Por defecto, permitimos el acceso libre en desarrollo si no hay token configurado.
    // Ejemplo de implementación real:
    // try {
    //   const payload = jwt.verify(token, process.env.JWT_SECRET);
    //   return payload.allowedRooms.includes(room);
    // } catch { return false; }
    
    return true; 
  }
}

// ============================================================================
// GUÍA DE ESCALABILIDAD HORIZONTAL CON REDIS (`y-redis`)
// ============================================================================
/*
Cuando tu aplicación Figma-like escale a múltiples servidores Node.js detrás de un balanceador de carga,
las conexiones WebSocket se distribuirán aleatoriamente entre las instancias. Si el Usuario A se conecta
al Servidor 1 y el Usuario B al Servidor 2, no verán los cambios del otro a menos que los servidores
se comuniquen entre sí.

Para solucionar esto, Yjs utiliza el patrón Pub/Sub a través de Redis con el adaptador `y-redis`.

CÓMO INTEGRAR `y-redis`:

1. Instala el paquete:
   npm install y-redis

2. Configura el adaptador en este handler o en el inicio del servidor:
   import { RedisPersistence } from 'y-redis';

   const redisPersistence = new RedisPersistence({
     redisOpts: {
       url: 'redis://localhost:6379'
     }
   });

3. Al inicializar un documento compartido (WSSharedDoc) por primera vez en la sala:
   - Registra el adaptador de Redis:
     
     // Esto suscribe la instancia local a un canal Redis de esa sala.
     // Cualquier cambio local se publica en Redis, y cualquier cambio en Redis se aplica localmente.
     redisPersistence.bindState(room, sharedDoc);

4. Beneficios:
   - Sincronización instantánea inter-instancias.
   - Persistencia automática en Redis integrada de forma transparente.
   - Altamente resiliente a fallas en nodos individuales de Node.js.
*/
