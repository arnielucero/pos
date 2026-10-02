import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/infrastructure/database/migrations';
import { Migrator } from '../../src/infrastructure/database/Migrator';
import { SqlJsDatabase } from '../../src/infrastructure/database/SqlJsDatabase';
import { sqlJs } from '../support/harness';

describe('Migrations (sql.js)', () => {
  it('creates every table and index, is idempotent', async () => {
    const db = await SqlJsDatabase.open(await sqlJs());
    const m = new Migrator(db);
    expect(await m.migrate()).toBe(MIGRATIONS.length);
    expect(await m.migrate()).toBe(0);
    expect(await m.currentVersion()).toBe(MIGRATIONS.at(-1)?.version);
    const tables = (await db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r['name']);
    for (const t of [
      'products', 'inventory', 'inventory_movements', 'sales', 'sale_items', 'payments', 'customers', 'users',
      'approvers', 'stores', 'settings', 'register_sessions', 'sync_queue', 'sync_conflicts', 'audit_logs',
      'receipt_counters', 'schema_migrations',
    ]) {
      expect(tables).toContain(t);
    }
    const indexes = (await db.query(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((r) => r['name']);
    expect(indexes).toContain('idx_sync_queue_status_next');
    expect(indexes).toContain('idx_products_barcode');
    expect(indexes).toContain('idx_sales_created');
  });

  it('enforces uniqueness of sale uuid and receipt number', async () => {
    const db = await SqlJsDatabase.open(await sqlJs());
    await new Migrator(db).migrate();
    const insert = (uuid: string, receipt: string) =>
      db.execute(
        `INSERT INTO sales (uuid, receipt_number, cashier_uuid, cashier_name, store_uuid, device_uuid, register_session_uuid,
          subtotal, discount_total, tax_total, total, status, created_at, updated_at)
         VALUES (?, ?, 'c', 'c', 's', 'd', 'r', 0, 0, 0, 0, 'COMPLETED', 't', 't')`,
        [uuid, receipt],
      );
    await insert('u1', 'R1');
    await expect(insert('u1', 'R2')).rejects.toThrow();
    await expect(insert('u2', 'R1')).rejects.toThrow();
  });

  it('rolls back a failed migration completely', async () => {
    const db = await SqlJsDatabase.open(await sqlJs());
    const bad = new Migrator(db, undefined, [{ version: 1, name: 'bad', statements: ['CREATE TABLE ok (id INTEGER)', 'NOT SQL'] }]);
    await expect(bad.migrate()).rejects.toThrow();
    const tables = (await db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'`)).length;
    expect(tables).toBe(0);
    expect(await bad.currentVersion()).toBe(0);
  });
});
