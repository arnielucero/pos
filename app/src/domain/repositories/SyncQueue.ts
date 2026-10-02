import type { NewSyncConflict, NewSyncQueueItem, SyncConflict, SyncCounts, SyncQueueItem } from '../entities/Sync';

export interface SyncQueue {
  enqueue(item: NewSyncQueueItem): Promise<void>;
  /** Atomically moves up to `limit` due PENDING items to IN_FLIGHT and returns them (oldest first). */
  claimDue(now: Date, limit: number): Promise<readonly SyncQueueItem[]>;
  markDone(id: number): Promise<void>;
  markRetry(id: number, attempts: number, nextRetryAt: string, errorCode: string, errorMessage: string): Promise<void>;
  markFailed(id: number, attempts: number, errorCode: string, errorMessage: string): Promise<void>;
  /** Puts IN_FLIGHT items back to PENDING without consuming an attempt (auth pause / interruption). */
  release(ids: readonly number[]): Promise<void>;
  /** Crash recovery: every IN_FLIGHT item becomes PENDING. Returns how many were reset. */
  resetInFlight(): Promise<number>;
  /** Manager action: FAILED item back to PENDING with attempts reset. */
  requeueFailed(id: number): Promise<void>;
  counts(): Promise<SyncCounts>;
  list(status: SyncQueueItem['status'], limit: number): Promise<readonly SyncQueueItem[]>;
  findByUuid(uuid: string): Promise<SyncQueueItem | null>;
  nextDueAt(): Promise<string | null>;
}

export interface SyncConflictRepository {
  addMany(conflicts: readonly NewSyncConflict[]): Promise<void>;
  list(limit: number): Promise<readonly SyncConflict[]>;
}
