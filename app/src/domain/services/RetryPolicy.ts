/**
 * Sync retry schedule: 5s, 15s, 30s, 60s, then 300s (capped). After MAX_ATTEMPTS failed
 * attempts the operation becomes FAILED (never deleted; visible in diagnostics).
 */
export const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 300_000] as const;
export const MAX_SYNC_ATTEMPTS = 8;

export type RetryDecision = { readonly kind: 'RETRY'; readonly delayMs: number } | { readonly kind: 'GIVE_UP' };

export class RetryPolicy {
  constructor(
    private readonly schedule: readonly number[] = BACKOFF_SCHEDULE_MS,
    readonly maxAttempts: number = MAX_SYNC_ATTEMPTS,
  ) {}

  /** Delay before the next attempt after `attempts` failed attempts (1-based). */
  delayFor(attempts: number): number {
    const idx = Math.min(Math.max(attempts, 1), this.schedule.length) - 1;
    return this.schedule[idx] ?? this.schedule[this.schedule.length - 1] ?? 300_000;
  }

  /** Decide what to do after a retryable failure; `attempts` already includes this failure. */
  afterFailure(attempts: number): RetryDecision {
    if (attempts >= this.maxAttempts) return { kind: 'GIVE_UP' };
    return { kind: 'RETRY', delayMs: this.delayFor(attempts) };
  }
}
