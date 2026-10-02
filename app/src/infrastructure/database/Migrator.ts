import type { Logger } from '../../application/ports/Logger';
import { MIGRATIONS, type Migration } from './migrations';
import type { SqlDatabase } from './SqlDatabase';

/** Applies pending migrations, each inside its own transaction, recording them in schema_migrations. */
export class Migrator {
  constructor(
    private readonly db: SqlDatabase,
    private readonly logger?: Logger,
    private readonly migrations: readonly Migration[] = MIGRATIONS,
  ) {}

  async currentVersion(): Promise<number> {
    await this.db.execute(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    const rows = await this.db.query('SELECT MAX(version) AS v FROM schema_migrations');
    const v = rows[0]?.['v'];
    return typeof v === 'number' ? v : 0;
  }

  async migrate(): Promise<number> {
    const current = await this.currentVersion();
    const pending = [...this.migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
    for (const m of pending) {
      await this.db.transaction(async (tx) => {
        for (const sql of m.statements) await tx.execute(sql);
        await tx.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          m.version,
          m.name,
          new Date().toISOString(),
        ]);
      });
      this.logger?.info('Applied migration', { version: m.version, name: m.name });
    }
    return pending.length;
  }
}
