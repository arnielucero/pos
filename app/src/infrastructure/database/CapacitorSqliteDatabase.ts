import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SecureStore } from '../../application/ports/SecureStore';
import { SerializedSqlDatabase, type ExecuteResult, type SqlRow, type SqlValue } from './SqlDatabase';

const PASSPHRASE_KEY = 'db.passphrase';

function randomPassphrase(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Android SQLite via @capacitor-community/sqlite in SQLCipher mode
 * (`androidIsEncryption: true` in capacitor.config.ts). The passphrase is generated once with
 * the CSPRNG, kept in Keystore-backed secure storage, and handed to the plugin's own encrypted
 * secret store with setEncryptionSecret().
 */
export class CapacitorSqliteDatabase extends SerializedSqlDatabase {
  private constructor(
    private readonly sqlite: SQLiteConnection,
    private readonly conn: SQLiteDBConnection,
    private readonly name: string,
  ) {
    super();
  }

  static async open(name: string, secureStore: SecureStore): Promise<CapacitorSqliteDatabase> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    let passphrase = await secureStore.get(PASSPHRASE_KEY);
    if (!passphrase) {
      passphrase = randomPassphrase();
      await secureStore.set(PASSPHRASE_KEY, passphrase);
    }
    const stored = (await sqlite.isSecretStored()).result ?? false;
    if (!stored) {
      await sqlite.setEncryptionSecret(passphrase);
    } else {
      const matches = (await sqlite.checkEncryptionSecret(passphrase)).result ?? false;
      if (!matches) throw new Error('Database encryption secret mismatch');
    }
    const consistent = (await sqlite.checkConnectionsConsistency()).result ?? false;
    const exists = (await sqlite.isConnection(name, false)).result ?? false;
    const conn =
      consistent && exists
        ? await sqlite.retrieveConnection(name, false)
        : await sqlite.createConnection(name, true, 'secret', 1, false);
    await conn.open();
    await conn.execute('PRAGMA foreign_keys = ON;', false);
    return new CapacitorSqliteDatabase(sqlite, conn, name);
  }

  protected async rawExecute(sql: string, params: readonly SqlValue[]): Promise<ExecuteResult> {
    const res = await this.conn.run(sql, [...params], false);
    return { changes: res.changes?.changes ?? 0, lastInsertId: res.changes?.lastId ?? null };
  }

  protected async rawQuery(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    const res = await this.conn.query(sql, [...params]);
    return (res.values ?? []) as SqlRow[];
  }

  protected async rawBegin(): Promise<void> {
    await this.conn.beginTransaction();
  }

  protected async rawCommit(): Promise<void> {
    await this.conn.commitTransaction();
  }

  protected async rawRollback(): Promise<void> {
    try {
      if ((await this.conn.isTransactionActive()).result) await this.conn.rollbackTransaction();
    } catch {
      // ignore: nothing to roll back
    }
  }

  async close(): Promise<void> {
    await this.sqlite.closeConnection(this.name, false);
  }
}
