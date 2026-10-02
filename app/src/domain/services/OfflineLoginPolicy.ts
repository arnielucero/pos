import {
  AccountLockedError,
  OfflineLoginNotAllowedError,
  OfflineSessionExpiredError,
} from '../errors/DomainError';

/** What is stored (in secure storage) for a user who has signed in online on this device. */
export interface OfflineCredentialState {
  readonly lastOnlineAuthAt: string;
  readonly failedAttempts: number;
  readonly maxOfflineHours: number;
  readonly maxFailedAttempts: number;
}

/**
 * Pure policy deciding whether an offline login attempt may proceed. Verification of the
 * password itself happens after this check (so a locked/expired account does not leak
 * whether the password was right).
 */
export class OfflineLoginPolicy {
  /** Throws a typed error when offline login must be refused. */
  assertAllowed(state: OfflineCredentialState | null, now: Date): void {
    if (!state) throw new OfflineLoginNotAllowedError();
    if (state.failedAttempts >= state.maxFailedAttempts) throw new AccountLockedError();
    const last = Date.parse(state.lastOnlineAuthAt);
    if (Number.isNaN(last)) throw new OfflineSessionExpiredError();
    const ageMs = now.getTime() - last;
    if (ageMs < 0 && Math.abs(ageMs) > 5 * 60_000) {
      // Clock moved backwards by more than 5 minutes: treat as suspicious and refuse.
      throw new OfflineSessionExpiredError();
    }
    if (ageMs > state.maxOfflineHours * 3_600_000) throw new OfflineSessionExpiredError();
  }

  /** Remaining attempts after a failure has been recorded. */
  remainingAfterFailure(state: OfflineCredentialState): number {
    return Math.max(0, state.maxFailedAttempts - (state.failedAttempts + 1));
  }
}
