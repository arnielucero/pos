import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { IndexedDbPersistence } from './IndexedDbPersistence';
import { SqlJsDatabase } from './SqlJsDatabase';

/** Web/dev database: sql.js WASM persisted to IndexedDB (unencrypted; dev/E2E only). */
export async function openWebDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = await SqlJsDatabase.open(SQL, new IndexedDbPersistence());
  const flush = (): void => {
    void db.flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return db;
}
