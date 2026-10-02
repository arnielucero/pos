import type {
  NewSyncConflict,
  NewSyncQueueItem,
  SyncConflict,
  SyncCounts,
  SyncOperationType,
  SyncQueueItem,
  SyncQueueStatus,
} from '../../domain/entities/Sync';
import type { SyncConflictRepository, SyncQueue } from '../../domain/repositories/SyncQueue';
import type { SqlExecutor, SqlRow } from '../database/SqlDatabase';
import { int, placeholders, str, strOrNull } from './rowMapping';

function mapItem(row: SqlRow): SyncQueueItem {
  let payload: unknown;
  try {
    payload = JSON.parse(str(row, 'payload'));
  } catch {
    payload = null;
  }
  return {
    id: int(row, 'id'),
    uuid: str(row, 'uuid'),
    entityType: str(row, 'entity_type'),
    entityId: str(row, 'entity_id'),
    operation: str(row, 'operation') as SyncOperationType,
    payload,
    status: str(row, 'status') as SyncQueueStatus,
    attempts: int(row, 'attempts'),
    lastAttemptAt: strOrNull(row, 'last_attempt_at'),
    nextRetryAt: strOrNull(row, 'next_retry_at'),
    errorCode: strOrNull(row, 'error_code'),
    errorMessage: strOrNull(row, 'error_message'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export class SqliteSyncQueue implements SyncQueue {
  constructor(
    private readonly db: SqlExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(item: NewSyncQueueItem): Promise<void> {
    const ts = this.now().toISOString();
    await this.db.execute(
      `INSERT INTO sync_queue (uuid, entity_type, entity_id, operation, payload, status, attempts, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`,
      // next_retry_at NULL = due immediately (independent of clock skew between writers)
      [item.uuid, item.entityType, item.entityId, item.operation, JSON.stringify(item.payload), ts, ts],
    );
  }

  async claimDue(now: Date, limit: number): Promise<readonly SyncQueueItem[]> {
    const ts = now.toISOString();
    const rows = await this.db.query(
      `SELECT * FROM sync_queue WHERE status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY id LIMIT ?`,
      [ts, limit],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => int(r, 'id'));
    await this.db.execute(
      `UPDATE sync_queue SET status = 'IN_FLIGHT', last_attempt_at = ?, updated_at = ? WHERE id IN (${placeholders(ids.length)})`,
      [ts, ts, ...ids],
    );
    return rows.map((r) => ({ ...mapItem(r), status: 'IN_FLIGHT' as const, lastAttemptAt: ts }));
  }

  async markDone(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE sync_queue SET status = 'DONE', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?`,
      [this.now().toISOString(), id],
    );
  }

  async markRetry(id: number, attempts: number, nextRetryAt: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.db.execute(
      `UPDATE sync_queue SET status = 'PENDING', attempts = ?, next_retry_at = ?, error_code = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [attempts, nextRetryAt, errorCode, errorMessage.slice(0, 500), this.now().toISOString(), id],
    );
  }

  async markFailed(id: number, attempts: number, errorCode: string, errorMessage: string): Promise<void> {
    await this.db.execute(
      `UPDATE sync_queue SET status = 'FAILED', attempts = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      [attempts, errorCode, errorMessage.slice(0, 500), this.now().toISOString(), id],
    );
  }

  async release(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(
      `UPDATE sync_queue SET status = 'PENDING', updated_at = ? WHERE status = 'IN_FLIGHT' AND id IN (${placeholders(ids.length)})`,
      [this.now().toISOString(), ...ids],
    );
  }

  async resetInFlight(): Promise<number> {
    const res = await this.db.execute(`UPDATE sync_queue SET status = 'PENDING', updated_at = ? WHERE status = 'IN_FLIGHT'`, [
      this.now().toISOString(),
    ]);
    return res.changes;
  }

  async requeueFailed(id: number): Promise<void> {
    const ts = this.now().toISOString();
    await this.db.execute(
      `UPDATE sync_queue SET status = 'PENDING', attempts = 0, next_retry_at = NULL, updated_at = ? WHERE id = ? AND status = 'FAILED'`,
      [ts, id],
    );
  }

  async counts(): Promise<SyncCounts> {
    const rows = await this.db.query(
      `SELECT status, COUNT(*) AS n FROM sync_queue WHERE status IN ('PENDING','IN_FLIGHT','FAILED') GROUP BY status`,
    );
    const by = new Map(rows.map((r) => [str(r, 'status'), int(r, 'n')]));
    const flagged = await this.db.query(`SELECT COUNT(*) AS n FROM sales WHERE sync_status = 'FLAGGED'`);
    return {
      pending: by.get('PENDING') ?? 0,
      inFlight: by.get('IN_FLIGHT') ?? 0,
      failed: by.get('FAILED') ?? 0,
      flaggedSales: flagged[0] ? int(flagged[0], 'n') : 0,
    };
  }

  async list(status: SyncQueueStatus, limit: number): Promise<readonly SyncQueueItem[]> {
    const rows = await this.db.query(`SELECT * FROM sync_queue WHERE status = ? ORDER BY id DESC LIMIT ?`, [status, limit]);
    return rows.map(mapItem);
  }

  async findByUuid(uuid: string): Promise<SyncQueueItem | null> {
    const rows = await this.db.query(`SELECT * FROM sync_queue WHERE uuid = ?`, [uuid]);
    return rows[0] ? mapItem(rows[0]) : null;
  }

  async nextDueAt(): Promise<string | null> {
    const rows = await this.db.query(
      `SELECT MIN(COALESCE(next_retry_at, created_at)) AS t FROM sync_queue WHERE status = 'PENDING'`,
    );
    return rows[0] ? strOrNull(rows[0], 't') : null;
  }
}

export class SqliteSyncConflictRepository implements SyncConflictRepository {
  constructor(private readonly db: SqlExecutor) {}

  async addMany(conflicts: readonly NewSyncConflict[]): Promise<void> {
    const ts = new Date().toISOString();
    for (const c of conflicts) {
      await this.db.execute(
        `INSERT INTO sync_conflicts (entity_type, entity_id, conflict_type, local_version, server_version, local_payload,
          server_payload, message, resolution_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        [c.entityType, c.entityId, c.conflictType, c.localVersion, c.serverVersion, c.localPayload, c.serverPayload, c.message, ts],
      );
    }
  }

  async list(limit: number): Promise<readonly SyncConflict[]> {
    const rows = await this.db.query(`SELECT * FROM sync_conflicts ORDER BY id DESC LIMIT ?`, [limit]);
    return rows.map((r) => ({
      id: int(r, 'id'),
      entityType: str(r, 'entity_type'),
      entityId: str(r, 'entity_id'),
      conflictType: str(r, 'conflict_type'),
      localVersion: strOrNull(r, 'local_version'),
      serverVersion: strOrNull(r, 'server_version'),
      localPayload: strOrNull(r, 'local_payload'),
      serverPayload: strOrNull(r, 'server_payload'),
      message: strOrNull(r, 'message'),
      resolutionStatus: str(r, 'resolution_status') === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
      createdAt: str(r, 'created_at'),
    }));
  }
}
