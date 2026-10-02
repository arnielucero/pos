export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface ExecuteResult {
  readonly changes: number;
  readonly lastInsertId: number | null;
}

export interface SqlExecutor {
  execute(sql: string, params?: readonly SqlValue[]): Promise<ExecuteResult>;
  query(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
}

/**
 * Minimal async SQL database abstraction implemented by CapacitorSqliteDatabase (Android,
 * SQLCipher) and SqlJsDatabase (web/dev/E2E and Node tests).
 *
 * All access is serialized: while a transaction runs, other callers wait, so statements from
 * concurrent async flows never interleave inside someone else's transaction.
 */
export interface SqlDatabase extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** FIFO async mutex. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Template for engines: subclasses implement the raw (unlocked) primitives. */
export abstract class SerializedSqlDatabase implements SqlDatabase {
  private readonly mutex = new Mutex();

  protected abstract rawExecute(sql: string, params: readonly SqlValue[]): Promise<ExecuteResult>;
  protected abstract rawQuery(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]>;
  protected abstract rawBegin(): Promise<void>;
  protected abstract rawCommit(): Promise<void>;
  protected abstract rawRollback(): Promise<void>;
  protected afterWrite(): void {
    /* hook for persistence */
  }
  abstract close(): Promise<void>;

  execute(sql: string, params: readonly SqlValue[] = []): Promise<ExecuteResult> {
    return this.mutex.lock(async () => {
      const res = await this.rawExecute(sql, params);
      this.afterWrite();
      return res;
    });
  }

  query(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    return this.mutex.lock(() => this.rawQuery(sql, params));
  }

  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.mutex.lock(async () => {
      let open = true;
      const guard = (): void => {
        if (!open) throw new Error('Transaction executor used after the transaction finished');
      };
      const tx: SqlExecutor = {
        execute: (sql, params = []) => {
          guard();
          return this.rawExecute(sql, params);
        },
        query: (sql, params = []) => {
          guard();
          return this.rawQuery(sql, params);
        },
      };
      await this.rawBegin();
      try {
        const result = await work(tx);
        open = false;
        await this.rawCommit();
        this.afterWrite();
        return result;
      } catch (e) {
        open = false;
        await this.rawRollback();
        throw e;
      }
    });
  }
}
