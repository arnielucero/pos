import type { InventoryBalance, InventoryMovement } from '../entities/Inventory';

export interface ServerBalance {
  readonly productUuid: string;
  readonly quantityOnHand: number;
  readonly updatedAt: string;
}

export interface InventoryRepository {
  getBalances(productUuids: readonly string[]): Promise<ReadonlyMap<string, InventoryBalance>>;
  /** Inserts the movement into the local ledger and applies it to the effective balance. */
  applyMovement(movement: InventoryMovement): Promise<void>;
  /**
   * Stores server balances. Effective balance = server balance + Σ(unsynced local movements),
   * so pending local sales are never "un-deducted" by a pull.
   */
  applyServerBalances(balances: readonly ServerBalance[]): Promise<void>;
  markMovementsSyncedByReference(reference: string): Promise<void>;
  markMovementSynced(uuid: string): Promise<void>;
  listMovements(productUuid: string, limit: number): Promise<readonly InventoryMovement[]>;
  listByReference(reference: string): Promise<readonly InventoryMovement[]>;
}
