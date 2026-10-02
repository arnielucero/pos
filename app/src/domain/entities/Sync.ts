export const SYNC_OPERATIONS = [
  'CREATE_SALE',
  'VOID_SALE',
  'ADJUST_INVENTORY',
  'OPEN_REGISTER',
  'CLOSE_REGISTER',
  'AUDIT_EVENTS',
] as const;
export type SyncOperationType = (typeof SYNC_OPERATIONS)[number];

export type SyncQueueStatus = 'PENDING' | 'IN_FLIGHT' | 'DONE' | 'FAILED';

export interface SyncQueueItem {
  readonly id: number;
  /** Idempotency key sent to the server. Never changes once enqueued. */
  readonly uuid: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperationType;
  readonly payload: unknown;
  readonly status: SyncQueueStatus;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly nextRetryAt: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewSyncQueueItem {
  readonly uuid: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperationType;
  readonly payload: unknown;
}

export type ConflictResolutionStatus = 'OPEN' | 'RESOLVED';

export interface SyncConflict {
  readonly id: number;
  readonly entityType: string;
  readonly entityId: string;
  readonly conflictType: string;
  readonly localVersion: string | null;
  readonly serverVersion: string | null;
  readonly localPayload: string | null;
  readonly serverPayload: string | null;
  readonly message: string | null;
  readonly resolutionStatus: ConflictResolutionStatus;
  readonly createdAt: string;
}

export type NewSyncConflict = Omit<SyncConflict, 'id' | 'resolutionStatus' | 'createdAt'>;

export interface SyncCounts {
  readonly pending: number;
  readonly inFlight: number;
  readonly failed: number;
  readonly flaggedSales: number;
}
