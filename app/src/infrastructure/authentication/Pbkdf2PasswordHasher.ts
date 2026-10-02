import type { PasswordHasher, PasswordVerifier } from '../../application/ports/Credentials';

/** OWASP 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 210_000;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Offline verifier via WebCrypto PBKDF2-SHA256 with a random 16-byte salt. */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  constructor(private readonly iterations = PBKDF2_ITERATIONS) {}

  private async derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return new Uint8Array(bits);
  }

  async createVerifier(password: string): Promise<PasswordVerifier> {
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);
    const hash = await this.derive(password, salt, this.iterations);
    return { algorithm: 'PBKDF2-SHA256', iterations: this.iterations, salt: toB64(salt), hash: toB64(hash) };
  }

  async verify(password: string, v: PasswordVerifier): Promise<boolean> {
    if (v.algorithm !== 'PBKDF2-SHA256' || v.iterations < 1) return false;
    const hash = await this.derive(password, fromB64(v.salt), v.iterations);
    return constantTimeEqual(hash, fromB64(v.hash));
  }
}
