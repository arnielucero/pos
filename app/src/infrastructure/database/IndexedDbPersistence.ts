import type { SqlJsPersistence } from './SqlJsDatabase';

/** Persists the sql.js database file into IndexedDB (web/dev only). */
export class IndexedDbPersistence implements SqlJsPersistence {
  constructor(
    private readonly dbName = 'hmr-pos',
    private readonly key = 'sqlite',
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB open failed'));
      };
    });
  }

  async load(): Promise<Uint8Array | null> {
    const idb = await this.open();
    try {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const req = idb.transaction('files', 'readonly').objectStore('files').get(this.key);
        req.onsuccess = () => {
          const v: unknown = req.result;
          resolve(v instanceof Uint8Array ? v : null);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('IndexedDB read failed'));
        };
      });
    } finally {
      idb.close();
    }
  }

  async save(bytes: Uint8Array): Promise<void> {
    const idb = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('files', 'readwrite');
        tx.objectStore('files').put(bytes, this.key);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('IndexedDB write failed'));
        };
      });
    } finally {
      idb.close();
    }
  }
}
