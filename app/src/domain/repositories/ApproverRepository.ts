import type { Approver } from '../entities/Approval';

export interface ServerApprover {
  readonly userUuid: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly pinHash: string;
  readonly isActive: boolean;
}

export interface ApproverRepository {
  listActive(): Promise<readonly Approver[]>;
  findByUuid(uuid: string): Promise<Approver | null>;
  /** Upserts server-owned columns only (local attempt counters are preserved). */
  upsertMany(approvers: readonly ServerApprover[]): Promise<void>;
  updateAttempts(uuid: string, failedAttempts: number, lockedUntil: string | null): Promise<void>;
}
