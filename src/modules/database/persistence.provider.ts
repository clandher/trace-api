// PersistenceProvider: Proveedor de persistencia en memoria (extensible)
import * as Y from 'yjs';
import { IPersistenceProvider } from '../../types.js';

export class MemoryPersistenceProvider implements IPersistenceProvider {
  private storage = new Map<string, Uint8Array>();
  private updateCallbacks = new Map<string, (update: Uint8Array) => void>();

  async bindState(docName: string, doc: Y.Doc): Promise<void> {
    const persistedState = this.storage.get(docName);
    if (persistedState) {
      Y.applyUpdate(doc, persistedState);
    }
    let debounceTimeout: NodeJS.Timeout | null = null;
    const onUpdate = (_update: Uint8Array) => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        const state = Y.encodeStateAsUpdate(doc);
        this.storage.set(docName, state);
      }, 200);
    };
    doc.on('update', onUpdate);
    this.updateCallbacks.set(docName, onUpdate);
  }

  async saveState(docName: string, doc: Y.Doc): Promise<void> {
    const state = Y.encodeStateAsUpdate(doc);
    this.storage.set(docName, state);
  }

  async close(): Promise<void> {
    this.storage.clear();
    this.updateCallbacks.clear();
  }
}
