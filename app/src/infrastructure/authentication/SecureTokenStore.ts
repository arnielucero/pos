import { z } from 'zod';
import type { OfflineCredential, OfflineCredentialStore, TokenStore } from '../../application/ports/Credentials';
import type { AuthTokens } from '../../application/ports/Gateways';
import type { SecureStore } from '../../application/ports/SecureStore';

const TOKENS_KEY = 'auth.tokens';

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  accessExpiresAt: z.string(),
  refreshToken: z.string().min(1),
  refreshExpiresAt: z.string(),
});

/** Access + refresh tokens, only ever in secure storage (never SQLite/localStorage). */
export class SecureTokenStore implements TokenStore {
  private cache: AuthTokens | null | undefined;

  constructor(private readonly store: SecureStore) {}

  async get(): Promise<AuthTokens | null> {
    if (this.cache !== undefined) return this.cache;
    const raw = await this.store.get(TOKENS_KEY);
    let parsed: AuthTokens | null = null;
    if (raw) {
      try {
        const res = tokensSchema.safeParse(JSON.parse(raw));
        parsed = res.success ? res.data : null;
      } catch {
        parsed = null;
      }
    }
    this.cache = parsed;
    return parsed;
  }

  async save(tokens: AuthTokens): Promise<void> {
    await this.store.set(TOKENS_KEY, JSON.stringify(tokens));
    this.cache = tokens;
  }

  async clear(): Promise<void> {
    await this.store.remove(TOKENS_KEY);
    this.cache = null;
  }
}

const credentialSchema = z.object({
  email: z.string(),
  user: z.object({
    uuid: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    permissions: z.array(z.string()),
    store: z.object({ uuid: z.string(), code: z.string(), name: z.string() }),
  }),
  verifier: z.object({
    algorithm: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().positive(),
    salt: z.string(),
    hash: z.string(),
  }),
  lastOnlineAuthAt: z.string(),
  failedAttempts: z.number().int().min(0),
  policy: z.object({ maxOfflineHours: z.number().positive(), maxFailedAttempts: z.number().int().positive() }),
});

const INDEX_KEY = 'offline.index';
const credKey = (email: string): string => `offline.cred.${email.toLowerCase()}`;

/** Offline verifiers for the most recent N online users (secure storage). */
export class SecureOfflineCredentialStore implements OfflineCredentialStore {
  constructor(private readonly store: SecureStore) {}

  async listEmails(): Promise<readonly string[]> {
    const raw = await this.store.get(INDEX_KEY);
    if (!raw) return [];
    try {
      const v = z.array(z.string()).safeParse(JSON.parse(raw));
      return v.success ? v.data : [];
    } catch {
      return [];
    }
  }

  async get(email: string): Promise<OfflineCredential | null> {
    const raw = await this.store.get(credKey(email));
    if (!raw) return null;
    try {
      const v = credentialSchema.safeParse(JSON.parse(raw));
      return v.success ? v.data : null;
    } catch {
      return null;
    }
  }

  async save(credential: OfflineCredential, maxUsers: number): Promise<void> {
    const email = credential.email.toLowerCase();
    await this.store.set(credKey(email), JSON.stringify({ ...credential, email }));
    const index = (await this.listEmails()).filter((e) => e !== email);
    index.unshift(email);
    const keep = index.slice(0, maxUsers);
    for (const evicted of index.slice(maxUsers)) await this.store.remove(credKey(evicted));
    await this.store.set(INDEX_KEY, JSON.stringify(keep));
  }

  async updateFailedAttempts(email: string, failedAttempts: number): Promise<void> {
    const cred = await this.get(email);
    if (!cred) return;
    await this.store.set(credKey(email), JSON.stringify({ ...cred, failedAttempts }));
  }

  async remove(email: string): Promise<void> {
    await this.store.remove(credKey(email));
    const index = (await this.listEmails()).filter((e) => e !== email.toLowerCase());
    await this.store.set(INDEX_KEY, JSON.stringify(index));
  }
}
