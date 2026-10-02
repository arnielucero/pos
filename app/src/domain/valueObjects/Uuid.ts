import { ValidationError } from '../errors/DomainError';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Uuid = string & { readonly __brand?: 'Uuid' };

export function isUuid(value: string): value is Uuid {
  return UUID_RE.test(value);
}

export function assertUuid(value: string, field = 'uuid'): Uuid {
  if (!isUuid(value)) throw new ValidationError(`${field} must be a UUID`, { [field]: ['invalid uuid'] });
  return value;
}

/** RFC 4122 v4 using the platform CSPRNG (WebCrypto exists in browsers, Android WebView and Node 20). */
export function newUuid(): Uuid {
  return globalThis.crypto.randomUUID();
}
