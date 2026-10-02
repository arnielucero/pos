const SENSITIVE_WORDS = new Set([
  'password',
  'passwd',
  'pass',
  'token',
  'secret',
  'pin',
  'card',
  'cvv',
  'cvc',
  'pan',
  'authorization',
  'passphrase',
  'verifier',
  'salt',
  'hash',
  'cookie',
]);

/** Splits camelCase / snake_case / kebab keys into lower-case words. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  return words(key).some((w) => SENSITIVE_WORDS.has(w));
}
const BEARER = /Bearer\s+[A-Za-z0-9._|~+/=-]+/g;
const LONG_DIGITS = /\b\d{12,19}\b/g; // card-number-like sequences
export const REDACTED = '[REDACTED]';

/**
 * Recursively strips secrets from log context: any key that looks like password/token/pin/
 * card/secret is replaced, bearer tokens and card-like digit runs inside strings are masked.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[DEPTH]';
  if (typeof value === 'string') return value.replace(BEARER, `Bearer ${REDACTED}`).replace(LONG_DIGITS, REDACTED);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
