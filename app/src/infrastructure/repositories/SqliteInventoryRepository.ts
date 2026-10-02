import type { InventoryBalance, InventoryMovement, MovementType } from '../../domain/entities/Inventory';
import type { InventoryRepository, ServerBalance } from '../../domain/repositories/InventoryRepository';
import type { SqlExecutor, SqlRow } from '../database/SqlDatabase';
import { int, placeholders, str, strOrNull } from './rowMapping';

function mapMovement(row: SqlRow): InventoryMovement {
  return {
    uuid: str(row, 'uuid'),
    productUuid: str(row, 'product_uuid'),
    type: str(row, 'type') as MovementType,
    quantity: int(row, 'quantity'),
    reference: strOrNull(row, 'reference'),
    reason: strOrNull(row, 'reason'),
    createdAt: str(row, 'created_at'),
    syncStatus: str(row, 'sync_status') === 'SYNCED' ? 'SYNCED' : 'PENDING',
  };
}

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private readonly db: SqlExecutor) {}

  async getBalances(productUuids: readonly string[]): Promise<ReadonlyMap<string, InventoryBalance>> {
    const out = new Map<string, InventoryBalance>();
    if (productUuids.length === 0) return out;
    for (let i = 0; i < productUuids.length; i += 500) {
      const chunk = productUuids.slice(i, i + 500);
      const rows = await this.db.query(
        `SELECT product_uuid, server_quantity, quantity_on_hand, updated_at FROM inventory WHERE product_uuid IN (${placeholders(chunk.length)})`,
        chunk,
      );
      for (const r of rows) {
        out.set(str(r, 'product_uuid'), {
          productUuid: str(r, 'product_uuid'),
          serverQuantity: int(r, 'server_quantity'),
          quantityOnHand: int(r, 'quantity_on_hand'),
          updatedAt: str(r, 'updated_at'),
        });
      }
    }
    return out;
  }

  async applyMovement(m: InventoryMovement): Promise<void> {
    await this.db.execute(
      `INSERT INTO inventory_movements (uuid, product_uuid, type, quantity, reference, reason, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.uuid, m.productUuid, m.type, m.quantity, m.reference, m.reason, m.createdAt, m.syncStatus],
    );
    await this.db.execute(
      `INSERT INTO inventory (product_uuid, server_quantity, quantity_on_hand, server_updated_at, updated_at)
       VALUES (?, 0, ?, NULL, ?)
       ON CONFLICT (product_uuid) DO UPDATE SET quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand,
         updated_at = excluded.updated_at`,
      [m.productUuid, m.quantity, m.createdAt],
    );
  }

  async applyServerBalances(balances: readonly ServerBalance[]): Promise<void> {
    for (const b of balances) {
      // effective = server balance + Σ local movements the server has not seen yet
      await this.db.execute(
        `INSERT INTO inventory (product_uuid, server_quantity, quantity_on_hand, server_updated_at, updated_at)
         VALUES (?, ?, ? + COALESCE((SELECT SUM(quantity) FROM inventory_movements
                                       WHERE product_uuid = ? AND sync_status = 'PENDING'), 0), ?, ?)
         ON CONFLICT (product_uuid) DO UPDATE SET server_quantity = excluded.server_quantity,
           quantity_on_hand = excluded.quantity_on_hand, server_updated_at = excluded.server_updated_at,
           updated_at = excluded.updated_at`,
        [b.productUuid, b.quantityOnHand, b.quantityOnHand, b.productUuid, b.updatedAt, b.updatedAt],
      );
    }
  }

  async markMovementsSyncedByReference(reference: string): Promise<void> {
    await this.db.execute(`UPDATE inventory_movements SET sync_status = 'SYNCED' WHERE reference = ?`, [reference]);
  }

  async markMovementSynced(uuid: string): Promise<void> {
    await this.db.execute(`UPDATE inventory_movements SET sync_status = 'SYNCED' WHERE uuid = ?`, [uuid]);
  }

  async listMovements(productUuid: string, limit: number): Promise<readonly InventoryMovement[]> {
    const rows = await this.db.query(
      `SELECT * FROM inventory_movements WHERE product_uuid = ? ORDER BY created_at DESC LIMIT ?`,
      [productUuid, limit],
    );
    return rows.map(mapMovement);
  }

  async listByReference(reference: string): Promise<readonly InventoryMovement[]> {
    const rows = await this.db.query(`SELECT * FROM inventory_movements WHERE reference = ? ORDER BY created_at`, [reference]);
    return rows.map(mapMovement);
  }
}
