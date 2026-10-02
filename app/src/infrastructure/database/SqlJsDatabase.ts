import type { Database, SqlJsStatic } from 'sql.js';
import { SerializedSqlDatabase, type ExecuteResult, type SqlRow, type SqlValue } from './SqlDatabase';

export interface SqlJsPersistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

/**
 * sql.js (SQLite compiled to WASM). Used for the web/dev build, Playwright E2E and Node
 * integration tests. NOT encrypted — the web build is a development/demo target only; the
 * Android build uses CapacitorSqliteDatabase with SQLCipher.
 */
export class SqlJsDatabase extends SerializedSqlDatabase {
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly db: Database,
    private readonly persistence: SqlJsPersistence | null,
  ) {
    super();
    db.run('PRAGMA foreign_keys = ON');
  }

  static async open(SQL: SqlJsStatic, persistence: SqlJsPersistence | null = null, bytes?: Uint8Array): Promise<SqlJsDatabase> {
    const initial = bytes ?? (persistence ? await persistence.load() : null);
    return new SqlJsDatabase(initial ? new SQL.Database(initial) : new SQL.Database(), persistence);
  }

  /** Serialized database file (used for persistence and crash-recovery tests). */
  exportBytes(): Uint8Array {
    return this.db.export();
  }

  protected rawExecute(sql: string, params: readonly SqlValue[]): Promise<ExecuteResult> {
    this.db.run(sql, params as SqlValue[]);
    const changes = this.db.getRowsModified();
    const idRow = this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    return Promise.resolve({ changes, lastInsertId: typeof idRow === 'number' ? idRow : null });
  }

  protected rawQuery(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as SqlValue[]);
      const rows: SqlRow[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as SqlRow);
      return Promise.resolve(rows);
    } finally {
      stmt.free();
    }
  }

  protected rawBegin(): Promise<void> {
    this.db.run('BEGIN IMMEDIATE');
    return Promise.resolve();
  }

  protected rawCommit(): Promise<void> {
    this.db.run('COMMIT');
    return Promise.resolve();
  }

  protected rawRollback(): Promise<void> {
    try {
      this.db.run('ROLLBACK');
    } catch {
      // no active transaction (e.g. BEGIN failed) — nothing to roll back
    }
    return Promise.resolve();
  }

  protected override afterWrite(): void {
    if (!this.persistence || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, 200);
  }

  async flush(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.save(this.db.export());
  }

  async close(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.flush();
    this.db.close();
  }
}
