import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthGateway, LoginResult } from '../../src/application/ports/Gateways';
import { RemoteCallError } from '../../src/application/ports/RemoteCallError';
import { SessionManager } from '../../src/application/session/SessionManager';
import { LoginUseCase } from '../../src/application/usecases/LoginUseCase';
import { OfflineLoginUseCase } from '../../src/application/usecases/OfflineLoginUseCase';
import { SignInUseCase } from '../../src/application/usecases/SignInUseCase';
import {
  AccountLockedError,
  InvalidCredentialsError,
  OfflineLoginNotAllowedError,
  OfflineSessionExpiredError,
} from '../../src/domain/errors/DomainError';
import { OfflineLoginPolicy } from '../../src/domain/services/OfflineLoginPolicy';
import { Pbkdf2PasswordHasher, PBKDF2_ITERATIONS } from '../../src/infrastructure/authentication/Pbkdf2PasswordHasher';
import { MemorySecureStore } from '../../src/infrastructure/authentication/SecureStores';
import { SecureOfflineCredentialStore, SecureTokenStore } from '../../src/infrastructure/authentication/SecureTokenStore';
import { SecureDeviceIdentity } from '../../src/infrastructure/device/SecureDeviceIdentity';
import { SqliteUnitOfWork } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { CASHIER, DEVICE, FakeClock, FakeNetwork, MANAGER, openTestDb, silentLogger } from '../support/harness';

class FakeAuth implements AuthGateway {
  failWith: Error | null = null;
  login(email: string, password: string): Promise<LoginResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    if (password !== 'password') return Promise.reject(new RemoteCallError('HTTP', 'INVALID_CREDENTIALS', 'bad', 401, false));
    const user = email.startsWith('manager') ? MANAGER : CASHIER;
    return Promise.resolve({
      tokens: { accessToken: 'a', accessExpiresAt: '2099-01-01T00:00:00Z', refreshToken: 'r', refreshExpiresAt: '2099-01-01T00:00:00Z' },
      user,
      device: DEVICE,
      offlinePolicy: { maxOfflineHours: 72, maxFailedAttempts: 3 },
      serverTime: '2026-10-02T01:00:00Z',
    });
  }
  logout(): Promise<void> {
    return Promise.resolve();
  }
}

describe('OfflineLoginPolicy', () => {
  const policy = new OfflineLoginPolicy();
  const now = new Date('2026-10-05T00:00:00Z');
  const state = { lastOnlineAuthAt: '2026-10-03T00:00:00Z', failedAttempts: 0, maxOfflineHours: 72, maxFailedAttempts: 5 };
  it('allows recent users', () => {
    expect(() => {
      policy.assertAllowed(state, now);
    }).not.toThrow();
  });
  it('refuses unknown users', () => {
    expect(() => {
      policy.assertAllowed(null, now);
    }).toThrow(OfflineLoginNotAllowedError);
  });
  it('refuses after max_offline_hours', () => {
    expect(() => {
      policy.assertAllowed({ ...state, lastOnlineAuthAt: '2026-10-01T23:59:00Z' }, now);
    }).toThrow(OfflineSessionExpiredError);
  });
  it('refuses when locked out', () => {
    expect(() => {
      policy.assertAllowed({ ...state, failedAttempts: 5 }, now);
    }).toThrow(AccountLockedError);
  });
  it('refuses when the clock moved far backwards', () => {
    expect(() => {
      policy.assertAllowed({ ...state, lastOnlineAuthAt: '2026-10-06T00:00:00Z' }, now);
    }).toThrow(OfflineSessionExpiredError);
  });
});

describe('Online + offline login use cases', () => {
  let secure: MemorySecureStore;
  let clock: FakeClock;
  let session: SessionManager;
  let online: LoginUseCase;
  let offline: OfflineLoginUseCase;
  let auth: FakeAuth;
  let network: FakeNetwork;
  let signIn: SignInUseCase;

  beforeEach(async () => {
    const db = await openTestDb();
    const uow = new SqliteUnitOfWork(db);
    secure = new MemorySecureStore();
    clock = new FakeClock(new Date('2026-10-02T01:00:00Z'));
    session = new SessionManager();
    auth = new FakeAuth();
    network = new FakeNetwork('ONLINE');
    const hasher = new Pbkdf2PasswordHasher(1000); // fast for tests; production default asserted below
    const deps = {
      offlineCredentials: new SecureOfflineCredentialStore(secure),
      hasher,
      deviceIdentity: new SecureDeviceIdentity(secure),
      uow,
      session,
      clock,
      logger: silentLogger,
    };
    online = new LoginUseCase({ ...deps, auth, tokens: new SecureTokenStore(secure) });
    offline = new OfflineLoginUseCase(deps);
    signIn = new SignInUseCase(online, offline, network);
  });

  it('uses ≥ 210k PBKDF2 iterations by default', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(210_000);
    const v = await new Pbkdf2PasswordHasher().createVerifier('pw');
    expect(v.iterations).toBe(PBKDF2_ITERATIONS);
    expect(v.salt).not.toBe('');
  });

  it('stores tokens and an offline verifier (never the password) in secure storage', async () => {
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    const all = [...secure.data.values()].join('\n');
    expect(all).not.toContain('"password"');
    expect(all).toContain('PBKDF2-SHA256');
    expect(session.getState().authMode).toBe('ONLINE');
  });

  it('allows offline login after a recent online login', async () => {
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    session.clearUser();
    clock.advance(10 * 3_600_000);
    const res = await offline.execute({ email: 'Cashier@POS.test', password: 'password' });
    expect(res).toMatchObject({ kind: 'SIGNED_IN', mode: 'OFFLINE' });
    expect(session.getState().user?.uuid).toBe(CASHIER.uuid);
  });

  it('refuses offline login after max_offline_hours', async () => {
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    clock.advance(73 * 3_600_000);
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'password' })).rejects.toBeInstanceOf(OfflineSessionExpiredError);
  });

  it('refuses unknown users offline', async () => {
    await expect(offline.execute({ email: 'nobody@pos.test', password: 'password' })).rejects.toBeInstanceOf(OfflineLoginNotAllowedError);
  });

  it('locks out after max_failed_attempts, even with the right password, until an online login', async () => {
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'nope' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'nope' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'nope' })).rejects.toBeInstanceOf(AccountLockedError);
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'password' })).rejects.toBeInstanceOf(AccountLockedError);
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    await expect(offline.execute({ email: 'cashier@pos.test', password: 'password' })).resolves.toMatchObject({ mode: 'OFFLINE' });
  });

  it('SignIn falls back to offline on network failure but not on INVALID_CREDENTIALS', async () => {
    await online.execute({ email: 'cashier@pos.test', password: 'password' });
    auth.failWith = new RemoteCallError('NETWORK', 'NETWORK_ERROR', 'down', null, true);
    await expect(signIn.execute({ email: 'cashier@pos.test', password: 'password' })).resolves.toMatchObject({ mode: 'OFFLINE' });
    auth.failWith = new RemoteCallError('HTTP', 'INVALID_CREDENTIALS', 'bad', 401, false);
    await expect(signIn.execute({ email: 'cashier@pos.test', password: 'password' })).rejects.toBeInstanceOf(RemoteCallError);
    network.state = 'OFFLINE';
    auth.failWith = null;
    await expect(signIn.execute({ email: 'cashier@pos.test', password: 'password' })).resolves.toMatchObject({ mode: 'OFFLINE' });
  });

  it('keeps only the last N users able to log in offline', async () => {
    const store = new SecureOfflineCredentialStore(secure);
    const hasher = new Pbkdf2PasswordHasher(1000);
    for (let i = 0; i < 7; i++) {
      await store.save(
        { email: `u${String(i)}@x.test`, user: CASHIER, verifier: await hasher.createVerifier('p'), lastOnlineAuthAt: clock.now().toISOString(), failedAttempts: 0, policy: { maxOfflineHours: 72, maxFailedAttempts: 5 } },
        5,
      );
    }
    expect(await store.listEmails()).toEqual(['u6@x.test', 'u5@x.test', 'u4@x.test', 'u3@x.test', 'u2@x.test']);
    expect(await store.get('u0@x.test')).toBeNull();
  });
});
