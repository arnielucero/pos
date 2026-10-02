export type ApprovalMode = 'ONLINE' | 'OFFLINE_PIN';

/** Contract approval object (API.md "Approval object"), camelCased internally. */
export interface Approval {
  readonly approvedByUuid: string;
  readonly approvedByName: string;
  readonly approvedAt: string;
  readonly mode: ApprovalMode;
  readonly reason: string;
  /** The permission that was approved (client-side bookkeeping; not sent). */
  readonly permission: string;
}

export interface Approver {
  readonly userUuid: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly pinHash: string;
  readonly isActive: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: string | null;
}

export function toApprovalPayload(a: Approval | null | undefined): {
  approved_by_uuid: string;
  approved_at: string;
  mode: ApprovalMode;
  reason: string;
} | null {
  if (!a) return null;
  return { approved_by_uuid: a.approvedByUuid, approved_at: a.approvedAt, mode: a.mode, reason: a.reason.slice(0, 255) };
}
