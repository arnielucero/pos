import type { AuditEvent } from '../entities/Audit';

export interface AuditLogRepository {
  append(event: AuditEvent): Promise<void>;
  /** Assigns up to `limit` not-yet-batched events to `batchUuid` and returns them. */
  takeBatch(batchUuid: string, limit: number): Promise<readonly AuditEvent[]>;
  markBatchUploaded(batchUuid: string): Promise<void>;
  recent(limit: number): Promise<readonly AuditEvent[]>;
}
