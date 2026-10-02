import type { NewSyncConflict, SyncOperationType, SyncQueueItem } from '../../domain/entities/Sync';
import type { TransactionalRepositories, UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { RetryPolicy } from '../../domain/services/RetryPolicy';
import { newUuid } from '../../domain/valueObjects/Uuid';
import type { Clock } from '../ports/Clock';
import type { SyncGateway, SyncOperationResult } from '../ports/Gateways';
import type { Logger } from '../ports/Logger';
import { isRemoteCallError } from '../ports/RemoteCallError';
import type { SessionManager } from '../session/SessionManager';
import { auditEventsPayload } from '../sync/payloads';

export const PUSH_BATCH_SIZE = 50;
const AUDIT_BATCH_SIZE = 200;

export type PushStatus = 'OK' | 'NOTHING_TO_DO' | 'OFFLINE' | 'SERVER_ERROR' | 'AUTH_REQUIRED' | 'INTERRUPTED' | 'BLOCKED';

export interface PushSummary {
  readonly status: PushStatus;
  readonly sent: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly flagged: number;
  readonly rejected: number;
  readonly retried: number;
  readonly failed: number;
  readonly lastError: string | null;
}

/** Side effects on local entities once the server has (or definitively has not) accepted an op. */
interface OperationEffects {
  onAccepted(r: TransactionalRepositories, item: SyncQueueItem, result: SyncOperationResult, flagged: boolean): Promise<void>;
  onRejected(r: TransactionalRepositories, item: SyncQueueItem): Promise<void>;
}

const noop = (): Promise<void> => Promise.resolve();

/** Per-operation effect handlers (a table, not a switch, so new op types are additive). */
const EFFECTS: Record<SyncOperationType, OperationEffects> = {
  CREATE_SALE: {
    async onAccepted(r, item, result, flagged) {
      await r.saleWriter.updateSyncStatus(item.entityId, flagged ? 'FLAGGED' : 'SYNCED', result.serverId);
      // The server created its own SALE movements, so ours are now reflected in server balances.
      await r.inventory.markMovementsSyncedByReference(item.entityId);
    },
    async onRejected(r, item) {
      await r.saleWriter.updateSyncStatus(item.entityId, 'FAILED');
    },
  },
  VOID_SALE: {
    async onAccepted(r, item) {
      await r.inventory.markMovementsSyncedByReference(item.uuid);
    },
    onRejected: noop,
  },
  ADJUST_INVENTORY: {
    async onAccepted(r, item) {
      await r.inventory.markMovementSynced(item.entityId);
    },
    onRejected: noop,
  },
  OPEN_REGISTER: { onAccepted: noop, onRejected: noop },
  CLOSE_REGISTER: { onAccepted: noop, onRejected: noop },
  AUDIT_EVENTS: {
    async onAccepted(r, item) {
      await r.audit.markBatchUploaded(item.uuid);
    },
    onRejected: noop,
  },
};

/**
 * Pushes due sync_queue items to POST /sync in batches of ≤ 50, in queue order, and applies the
 * per-operation results (docs/OFFLINE_SYNC.md "Result handling"):
 *  - APPLIED / DUPLICATE → DONE, entity SYNCED (server_id stored)
 *  - FLAGGED (or DUPLICATE with original_status FLAGGED) → DONE, entity FLAGGED, sync_conflicts
 *    rows written (any conflict type, e.g. PRICE_MISMATCH, TAX_MISMATCH, DUPLICATE_RECEIPT_NUMBER)
 *  - REJECTED retryable → back to PENDING with exponential backoff (FAILED after max attempts)
 *  - REJECTED permanent → FAILED (kept forever, shown in diagnostics)
 *  - transport failure / 5xx / 429 → whole batch backs off
 *  - auth failure (refresh rejected) → batch released untouched, push paused, re-login required
 * The idempotency key is the queue row uuid, fixed at enqueue time, so re-pushing is safe.
 */
export class PushSyncQueueUseCase {
  private readonly retry: RetryPolicy;

  constructor(
    private readonly deps: {
      gateway: SyncGateway;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
      logger: Logger;
      retryPolicy?: RetryPolicy;
    },
  ) {
    this.retry = deps.retryPolicy ?? new RetryPolicy();
  }

  async execute(signal?: AbortSignal): Promise<PushSummary> {
    const d = this.deps;
    const totals = { sent: 0, applied: 0, duplicates: 0, flagged: 0, rejected: 0, retried: 0, failed: 0 };
    await this.enqueueAuditBatch();
    let status: PushStatus = 'NOTHING_TO_DO';
    let lastError: string | null = null;

    for (;;) {
      if (signal?.aborted) {
        status = 'INTERRUPTED';
        break;
      }
      const batch = await d.uow.run((r) => r.syncQueue.claimDue(d.clock.now(), PUSH_BATCH_SIZE));
      if (batch.length === 0) break;
      totals.sent += batch.length;

      let response;
      try {
        response = await d.gateway.push(
          batch.map((i) => ({ idempotencyKey: i.uuid, type: i.operation, payload: i.payload })),
          signal,
        );
      } catch (e) {
        const outcome = await this.handleTransportFailure(batch, e, signal);
        status = outcome.status;
        lastError = outcome.message;
        if (outcome.consumedAttempt) {
          totals.retried += outcome.retried;
          totals.failed += outcome.failed;
        }
        break;
      }

      const byKey = new Map(response.results.map((res) => [res.idempotencyKey, res]));
      for (const item of batch) {
        const result = byKey.get(item.uuid);
        if (!result) {
          // Partial response: the server may or may not have applied it — retrying is safe (idempotent).
          const gaveUp = await this.scheduleRetry(item, 'MISSING_RESULT', 'No result returned for this operation');
          if (gaveUp) totals.failed += 1;
          else totals.retried += 1;
          continue;
        }
        if (result.status === 'REJECTED') totals.rejected += 1;
        const kind = await this.applyResult(item, result);
        totals[kind] += 1;
      }
      status = 'OK';
    }

    if (status === 'OK' && totals.sent === 0) status = 'NOTHING_TO_DO';
    return { status, ...totals, lastError };
  }

  private async applyResult(
    item: SyncQueueItem,
    result: SyncOperationResult,
  ): Promise<'applied' | 'duplicates' | 'flagged' | 'retried' | 'failed'> {
    const d = this.deps;
    const effects = EFFECTS[item.operation];
    if (result.status === 'APPLIED' || result.status === 'DUPLICATE' || result.status === 'FLAGGED') {
      // A DUPLICATE of an op that was originally FLAGGED is still FLAGGED (backend notes §7.7).
      const flagged = result.status === 'FLAGGED' || (result.status === 'DUPLICATE' && result.originalStatus === 'FLAGGED');
      await d.uow.run(async (r) => {
        await r.syncQueue.markDone(item.id);
        await effects.onAccepted(r, item, result, flagged);
        if (flagged) await r.conflicts.addMany(toConflictRows(item, result));
      });
      if (flagged) d.logger.warning('Operation stored but FLAGGED for review', { op: item.operation, key: item.uuid });
      return flagged ? 'flagged' : result.status === 'DUPLICATE' ? 'duplicates' : 'applied';
    }
    // REJECTED
    const code = result.error?.code ?? 'REJECTED';
    const message = result.error?.message ?? 'Rejected by server';
    if (result.retryable) {
      const gaveUp = await this.scheduleRetry(item, code, message);
      return gaveUp ? 'failed' : 'retried';
    }
    await d.uow.run(async (r) => {
      await r.syncQueue.markFailed(item.id, item.attempts + 1, code, message);
      await effects.onRejected(r, item);
    });
    d.logger.error('Operation permanently rejected', { op: item.operation, key: item.uuid, code });
    if (code === 'INVALID_TOTALS' || code === 'IDEMPOTENCY_KEY_REUSED') {
      d.logger.security('Server reported integrity violation for a queued operation', { code, key: item.uuid });
    }
    return 'failed';
  }

  /** Returns true when the item was moved to FAILED (max attempts reached). */
  private async scheduleRetry(item: SyncQueueItem, code: string, message: string): Promise<boolean> {
    const d = this.deps;
    const attempts = item.attempts + 1;
    const decision = this.retry.afterFailure(attempts);
    if (decision.kind === 'GIVE_UP') {
      await d.uow.run(async (r) => {
        await r.syncQueue.markFailed(item.id, attempts, code, message);
        await EFFECTS[item.operation].onRejected(r, item);
      });
      d.logger.error('Operation failed after max attempts', { op: item.operation, key: item.uuid, attempts, code });
      return true;
    }
    const next = new Date(d.clock.now().getTime() + decision.delayMs).toISOString();
    await d.uow.run((r) => r.syncQueue.markRetry(item.id, attempts, next, code, message));
    return false;
  }

  private async handleTransportFailure(
    batch: readonly SyncQueueItem[],
    e: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ status: PushStatus; message: string; consumedAttempt: boolean; retried: number; failed: number }> {
    const d = this.deps;
    const ids = batch.map((i) => i.id);
    if (signal?.aborted) {
      await d.uow.run((r) => r.syncQueue.release(ids));
      return { status: 'INTERRUPTED', message: 'Sync interrupted', consumedAttempt: false, retried: 0, failed: 0 };
    }
    if (isRemoteCallError(e) && e.kind === 'AUTH_REQUIRED') {
      await d.uow.run((r) => r.syncQueue.release(ids));
      d.session.update({ reauthRequired: true });
      d.logger.security('Sync paused: re-authentication required', { code: e.code });
      return { status: 'AUTH_REQUIRED', message: e.message, consumedAttempt: false, retried: 0, failed: 0 };
    }
    if (isRemoteCallError(e) && !e.retryable && e.httpStatus === 403) {
      // Device disabled / store mismatch: not the payload's fault — pause without burning attempts.
      await d.uow.run((r) => r.syncQueue.release(ids));
      d.logger.error('Sync blocked by server', { code: e.code });
      return { status: 'BLOCKED', message: e.message, consumedAttempt: false, retried: 0, failed: 0 };
    }
    const retryable = !isRemoteCallError(e) || e.retryable;
    const code = isRemoteCallError(e) ? e.code : 'UNKNOWN';
    const message = e instanceof Error ? e.message : 'Unknown sync error';
    let retried = 0;
    let failed = 0;
    for (const item of batch) {
      if (retryable) {
        if (await this.scheduleRetry(item, code, message)) failed += 1;
        else retried += 1;
      } else {
        await d.uow.run(async (r) => {
          await r.syncQueue.markFailed(item.id, item.attempts + 1, code, message);
          await EFFECTS[item.operation].onRejected(r, item);
        });
        failed += 1;
      }
    }
    const offline = isRemoteCallError(e) && e.isNetworkFailure;
    d.logger.warning('Sync push failed', { code, retryable, items: batch.length });
    return { status: offline ? 'OFFLINE' : 'SERVER_ERROR', message, consumedAttempt: true, retried, failed };
  }

  /** Moves not-yet-uploaded local audit rows into one AUDIT_EVENTS queue operation. */
  private async enqueueAuditBatch(): Promise<void> {
    const batchUuid = newUuid();
    await this.deps.uow.run(async (r) => {
      const events = await r.audit.takeBatch(batchUuid, AUDIT_BATCH_SIZE);
      if (events.length === 0) return;
      await r.syncQueue.enqueue({
        uuid: batchUuid,
        entityType: 'audit_batch',
        entityId: batchUuid,
        operation: 'AUDIT_EVENTS',
        payload: auditEventsPayload(events),
      });
    });
  }
}

function toConflictRows(item: SyncQueueItem, result: SyncOperationResult): NewSyncConflict[] {
  const rows = result.conflicts.map(
    (c): NewSyncConflict => ({
      entityType: c.entityType ?? item.entityType,
      entityId: c.entityUuid ?? item.entityId,
      conflictType: c.type,
      localVersion: c.localValue === undefined ? null : JSON.stringify(c.localValue),
      serverVersion: c.serverValue === undefined ? null : JSON.stringify(c.serverValue),
      localPayload: JSON.stringify(item.payload),
      serverPayload: JSON.stringify(c),
      message: c.message,
    }),
  );
  if (rows.length > 0) return rows;
  return [
    {
      entityType: item.entityType,
      entityId: item.entityId,
      conflictType: 'FLAGGED',
      localVersion: null,
      serverVersion: null,
      localPayload: JSON.stringify(item.payload),
      serverPayload: JSON.stringify(result),
      message: 'Flagged by server without details',
    },
  ];
}
