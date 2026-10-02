export interface AuditEvent {
  readonly uuid: string;
  readonly action: string;
  readonly userUuid: string | null;
  readonly entityType: string | null;
  readonly entityUuid: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}
