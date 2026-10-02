import type { Approver } from '../entities/Approval';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 5 * 60_000;

/** Local manager-PIN brute-force protection (per approver). */
export class PinAttemptPolicy {
  constructor(
    readonly maxAttempts: number = MAX_PIN_ATTEMPTS,
    readonly lockoutMs: number = PIN_LOCKOUT_MS,
  ) {}

  isLocked(approver: Pick<Approver, 'lockedUntil'>, now: Date): boolean {
    return approver.lockedUntil !== null && Date.parse(approver.lockedUntil) > now.getTime();
  }

  /** New counters after a failed attempt. */
  onFailure(approver: Pick<Approver, 'failedAttempts'>, now: Date): { failedAttempts: number; lockedUntil: string | null } {
    const failed = approver.failedAttempts + 1;
    if (failed >= this.maxAttempts) {
      return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + this.lockoutMs).toISOString() };
    }
    return { failedAttempts: failed, lockedUntil: null };
  }

  remaining(approver: Pick<Approver, 'failedAttempts'>): number {
    return Math.max(0, this.maxAttempts - approver.failedAttempts);
  }
}
