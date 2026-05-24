import * as Y from 'yjs';

/**
 * Interfaz unificada para la persistencia del estado de documentos Yjs (Canvas).
 * Permite cargar el estado inicial del canvas al crearse una sala y guardar
 * los cambios de manera incremental o consolidada.
 */
export interface IPersistenceProvider {
  /**
   * Vincula un documento Yjs a la base de datos:
   * 1. Carga el estado guardado desde la DB y lo aplica al doc.
   * 2. Registra un callback de actualización para guardar los cambios a medida que ocurren.
   * 
   * @param docName ID único de la sala / canvas.
   * @param doc Instancia del documento Yjs.
   */
  bindState(docName: string, doc: Y.Doc): Promise<void>;

  /**
   * Guarda de forma manual o forzada el estado consolidado completo del canvas.
   * 
   * @param docName ID único de la sala / canvas.
   * @param doc Instancia del documento Yjs.
   */
  saveState(docName: string, doc: Y.Doc): Promise<void>;

  /**
   * Cierra las conexiones activas a las bases de datos correspondientes.
   */
  close(): Promise<void>;
}

// ============================================================================
// 1. PROVEEDOR EN MEMORIA (Ideal para Desarrollo Local y Pruebas Rápidas)
// ============================================================================
export class MemoryPersistenceProvider implements IPersistenceProvider {
  // Almacenamos el estado en un Map como un Uint8Array consolidado
  private storage = new Map<string, Uint8Array>();
  private updateCallbacks = new Map<string, (update: Uint8Array) => void>();

  async bindState(docName: string, doc: Y.Doc): Promise<void> {
    console.log(`[MemoryPersistence] Vinculando estado para la sala: ${docName}`);
    
    // 1. Recuperar estado guardado si existe
    const persistedState = this.storage.get(docName);
    if (persistedState) {
      console.log(`[MemoryPersistence] Aplicando estado guardado de ${persistedState.byteLength} bytes para ${docName}`);
      Y.applyUpdate(doc, persistedState);
    } else {
      console.log(`[MemoryPersistence] No hay estado previo para ${docName}. Se creará un canvas vacío.`);
    }

    // 2. Escuchar futuras actualizaciones para persistirlas (con debounce simple)
    let debounceTimeout: NodeJS.Timeout | null = null;
    
    const onUpdate = (_update: Uint8Array) => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      
      debounceTimeout = setTimeout(() => {
        const state = Y.encodeStateAsUpdate(doc);
        this.storage.set(docName, state);
        console.log(`[MemoryPersistence] Estado del canvas '${docName}' autoguardado con éxito. Tamaño: ${state.byteLength} bytes.`);
      }, 2000); // Debounce de 2 segundos para no sobrecargar el almacenamiento en escrituras masivas
    };

    doc.on('update', onUpdate);
    
    // Registrar callback de desconexión para poder remover el listener si el doc se destruye
    this.updateCallbacks.set(docName, onUpdate);
  }

  async saveState(docName: string, doc: Y.Doc): Promise<void> {
    const state = Y.encodeStateAsUpdate(doc);
    this.storage.set(docName, state);
    console.log(`[MemoryPersistence] Guardado forzado completado para '${docName}' (${state.byteLength} bytes).`);
  }

  async close(): Promise<void> {
    this.storage.clear();
    this.updateCallbacks.clear();
    console.log('[MemoryPersistence] Almacenamiento en memoria limpiado.');
  }
}

// ============================================================================
// 2. ADAPTADOR ESTRUCTURADO PARA MONGODB (Skeleton & Guía de Configuración)
// ============================================================================
/*
Para utilizar este proveedor, instala la dependencia oficial:
npm install mongodb
*/
export class MongoPersistenceProvider implements IPersistenceProvider {
  private dbUri: string;
  private dbName: string;
  private collectionName: string;
  private client: any | null = null; // Reemplazar con MongoClient al importar
  private db: any = null;

  constructor(uri: string = 'mongodb://localhost:27017', dbName: string = 'canvas_db', collection: string = 'canvas_states') {
    this.dbUri = uri;
    this.dbName = dbName;
    this.collectionName = collection;
  }

  private async getCollection() {
    if (!this.client) {
      // Configuración dinámica si la dependencia 'mongodb' está instalada
      try {
        const mongoPkg = 'mongodb';
        const { MongoClient } = await import(mongoPkg);
        this.client = new MongoClient(this.dbUri);
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        console.log('[MongoPersistence] Conectado exitosamente a MongoDB.');
      } catch (error) {
        console.error('[MongoPersistence] Error al conectar a MongoDB. ¿Instalaste la dependencia "mongodb"?', error);
        throw error;
      }
    }
    return this.db.collection(this.collectionName);
  }

  async bindState(docName: string, doc: Y.Doc): Promise<void> {
    console.log(`[MongoPersistence] Vinculando estado para: ${docName}`);
    try {
      const collection = await this.getCollection();
      
      // 1. Cargar el estado consolidado de la base de datos (guardado como Binary / Buffer)
      const record = await collection.findOne({ docName });
      if (record && record.state) {
        // En MongoDB Node driver, el tipo Binary se convierte a Buffer, que es compatible con Uint8Array
        const stateBuffer = new Uint8Array(record.state.buffer || record.state);
        Y.applyUpdate(doc, stateBuffer);
        console.log(`[MongoPersistence] Estado cargado con éxito para '${docName}' (${stateBuffer.byteLength} bytes).`);
      } else {
        console.log(`[MongoPersistence] No se encontró estado guardado para '${docName}'. Inicializando vacío.`);
      }

      // 2. Registrar el listener de actualizaciones con Debounce de guardado
      let debounceTimeout: NodeJS.Timeout | null = null;
      
      doc.on('update', (_update: Uint8Array) => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        
        debounceTimeout = setTimeout(async () => {
          try {
            const consolidatedState = Y.encodeStateAsUpdate(doc);
            
            // Guardamos el estado consolidado como buffer binario
            await collection.updateOne(
              { docName },
              { 
                $set: { 
                  state: Buffer.from(consolidatedState),
                  updatedAt: new Date()
                } 
              },
              { upsert: true }
            );
            console.log(`[MongoPersistence] Canvas '${docName}' guardado en MongoDB (${consolidatedState.byteLength} bytes).`);
          } catch (err) {
            console.error(`[MongoPersistence] Error guardando estado para '${docName}':`, err);
          }
        }, 3000); // 3 segundos de debounce para optimizar escrituras
      });

    } catch (error) {
      console.error(`[MongoPersistence] Fallo en bindState para ${docName}:`, error);
    }
  }

  async saveState(docName: string, doc: Y.Doc): Promise<void> {
    try {
      const collection = await this.getCollection();
      const consolidatedState = Y.encodeStateAsUpdate(doc);
      await collection.updateOne(
        { docName },
        { 
          $set: { 
            state: Buffer.from(consolidatedState),
            updatedAt: new Date()
          } 
        },
        { upsert: true }
      );
      console.log(`[MongoPersistence] Guardado forzado completado en MongoDB para '${docName}'.`);
    } catch (error) {
      console.error(`[MongoPersistence] Error en saveState manual para '${docName}':`, error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log('[MongoPersistence] Conexión a MongoDB cerrada.');
    }
  }
}

// ============================================================================
// 3. ADAPTADOR ESTRUCTURADO PARA REDIS (Skeleton & Guía de Configuración)
// ============================================================================
/*
Para utilizar este proveedor, instala la dependencia oficial:
npm install redis
*/
export class RedisPersistenceProvider implements IPersistenceProvider {
  private redisUrl: string;
  private client: any | null = null; // Reemplazar con el cliente de redis al importar

  constructor(url: string = 'redis://localhost:6379') {
    this.redisUrl = url;
  }

  private async getClient() {
    if (!this.client) {
      try {
        const redisPkg = 'redis';
        const { createClient } = await import(redisPkg);
        this.client = createClient({ url: this.redisUrl });
        await this.client.connect();
        console.log('[RedisPersistence] Conectado exitosamente a Redis.');
      } catch (error) {
        console.error('[RedisPersistence] Error al conectar a Redis. ¿Instalaste la dependencia "redis"?', error);
        throw error;
      }
    }
    return this.client;
  }

  private getKey(docName: string): string {
    return `yjs:doc:${docName}`;
  }

  async bindState(docName: string, doc: Y.Doc): Promise<void> {
    console.log(`[RedisPersistence] Vinculando estado para: ${docName}`);
    try {
      const redis = await this.getClient();
      const key = this.getKey(docName);
      
      // 1. Obtener buffer binario de Redis
      // En ioredis o redis de node, para obtener buffers binarios se usa el comando pasándole retorno de buffer
      const stateHex = await redis.get(redis.commandOptions({ returnBuffers: true }), key);
      
      if (stateHex) {
        const stateBuffer = new Uint8Array(stateHex);
        Y.applyUpdate(doc, stateBuffer);
        console.log(`[RedisPersistence] Estado cargado con éxito de Redis para '${docName}' (${stateBuffer.byteLength} bytes).`);
      } else {
        console.log(`[RedisPersistence] No se encontró estado previo en Redis para '${docName}'.`);
      }

      // 2. Listener con debounce para escribir en Redis
      let debounceTimeout: NodeJS.Timeout | null = null;
      
      doc.on('update', (_update: Uint8Array) => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        
        debounceTimeout = setTimeout(async () => {
          try {
            const consolidatedState = Y.encodeStateAsUpdate(doc);
            // Almacenar como buffer binario nativo en Redis
            await redis.set(key, Buffer.from(consolidatedState));
            console.log(`[RedisPersistence] Canvas '${docName}' guardado en Redis (${consolidatedState.byteLength} bytes).`);
          } catch (err) {
            console.error(`[RedisPersistence] Error de auto-guardado en Redis para '${docName}':`, err);
          }
        }, 3000);
      });

    } catch (error) {
      console.error(`[RedisPersistence] Fallo en bindState para '${docName}':`, error);
    }
  }

  async saveState(docName: string, doc: Y.Doc): Promise<void> {
    try {
      const redis = await this.getClient();
      const key = this.getKey(docName);
      const consolidatedState = Y.encodeStateAsUpdate(doc);
      await redis.set(key, Buffer.from(consolidatedState));
      console.log(`[RedisPersistence] Guardado forzado completado en Redis para '${docName}'.`);
    } catch (error) {
      console.error(`[RedisPersistence] Error en saveState manual en Redis para '${docName}':`, error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      console.log('[RedisPersistence] Conexión a Redis desconectada.');
    }
  }
}
