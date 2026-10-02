import type { AuditEvent } from '../../domain/entities/Audit';
import { newUuid } from '../../domain/valueObjects/Uuid';

export function auditEvent(
  action: string,
  occurredAt: Date,
  userUuid: string | null,
  entity: { type: string; uuid: string } | null,
  metadata: Record<string, unknown> = {},
): AuditEvent {
  return {
    uuid: newUuid(),
    action,
    userUuid,
    entityType: entity?.type ?? null,
    entityUuid: entity?.uuid ?? null,
    metadata,
    occurredAt: occurredAt.toISOString(),
  };
}
