// src/types.ts
// Tipos e interfaces globales
import * as Y from 'yjs';

export interface IPersistenceProvider {
  bindState(docName: string, doc: Y.Doc): Promise<void>;
  saveState(docName: string, doc: Y.Doc): Promise<void>;
  close(): Promise<void>;
}
