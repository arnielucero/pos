import { describe, expect, it } from 'vitest';
import { BACKOFF_SCHEDULE_MS, MAX_SYNC_ATTEMPTS, RetryPolicy } from '../../src/domain/services/RetryPolicy';

describe('RetryPolicy', () => {
  const policy = new RetryPolicy();
  it('follows 5s, 15s, 30s, 60s, 300s and caps at 300s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => policy.delayFor(n))).toEqual([5000, 15000, 30000, 60000, 300000, 300000, 300000]);
    expect(BACKOFF_SCHEDULE_MS).toEqual([5000, 15000, 30000, 60000, 300000]);
  });
  it('gives up after 8 attempts', () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(8);
    for (let n = 1; n < 8; n++) expect(policy.afterFailure(n).kind).toBe('RETRY');
    expect(policy.afterFailure(8)).toEqual({ kind: 'GIVE_UP' });
    expect(policy.afterFailure(9)).toEqual({ kind: 'GIVE_UP' });
  });
});
