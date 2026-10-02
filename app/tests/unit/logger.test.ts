import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redact, REDACTED } from '../../src/infrastructure/logging/Redactor';
import { MemorySink, StructuredLogger } from '../../src/infrastructure/logging/StructuredLogger';

describe('Redactor', () => {
  it('strips password/token/pin/card fields at any depth', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'secret',
      accessToken: 'abc',
      refresh_token: 'def',
      nested: { pin: '123456', pinHash: '$2y$12$x', cardNumber: '4111111111111111', ok: 1 },
      list: [{ Authorization: 'Bearer zzz' }],
    });
    expect(out).toEqual({
      email: 'a@b.c',
      password: REDACTED,
      accessToken: REDACTED,
      refresh_token: REDACTED,
      nested: { pin: REDACTED, pinHash: REDACTED, cardNumber: REDACTED, ok: 1 },
      list: [{ Authorization: REDACTED }],
    });
  });

  it('masks bearer tokens and card-like numbers inside strings', () => {
    expect(redact('header Bearer 1|abcdef.ghi')).toBe(`header Bearer ${REDACTED}`);
    expect(redact('card 4111111111111111 used')).toBe(`card ${REDACTED} used`);
  });

  it('does not over-redact innocent keys', () => {
    expect(isSensitiveKey('shipping')).toBe(false);
    expect(isSensitiveKey('spinner')).toBe(false);
    expect(isSensitiveKey('approvalMode')).toBe(false);
    expect(isSensitiveKey('pin')).toBe(true);
    expect(isSensitiveKey('offline_verifier')).toBe(true);
  });
});

describe('StructuredLogger', () => {
  it('writes structured redacted records with levels incl. SECURITY and AUDIT', () => {
    const sink = new MemorySink();
    const log = new StructuredLogger([sink], 'DEBUG', 'test');
    log.info('login', { password: 'x', user: 'u' });
    log.security('lockout', { pin: '000000' });
    log.audit('sale', { total: 100 });
    log.debug('dbg');
    const recs = sink.records();
    expect(recs.map((r) => r.level)).toEqual(['INFO', 'SECURITY', 'AUDIT', 'DEBUG']);
    expect(recs[0]?.context).toEqual({ password: REDACTED, user: 'u' });
    expect(recs[1]?.context).toEqual({ pin: REDACTED });
    expect(JSON.stringify(recs)).not.toContain('000000');
  });

  it('respects the minimum level', () => {
    const sink = new MemorySink();
    const log = new StructuredLogger([sink], 'WARNING');
    log.info('hidden');
    log.error('shown');
    expect(sink.records().map((r) => r.message)).toEqual(['shown']);
  });
});
