export type MovementType = 'SALE' | 'VOID' | 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';
export type MovementSyncStatus = 'PENDING' | 'SYNCED';

export interface InventoryMovement {
  readonly uuid: string;
  readonly productUuid: string;
  readonly type: MovementType;
  /** Signed: positive adds stock. */
  readonly quantity: number;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly syncStatus: MovementSyncStatus;
}

export interface InventoryBalance {
  readonly productUuid: string;
  /** Last balance reported by the server. */
  readonly serverQuantity: number;
  /** Effective local balance = server balance + unsynced local movements. */
  readonly quantityOnHand: number;
  readonly updatedAt: string;
}
