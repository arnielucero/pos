import { AccountLockedError, DeviceNotRegisteredError, InvalidCredentialsError } from '../../domain/errors/DomainError';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { OfflineLoginPolicy } from '../../domain/services/OfflineLoginPolicy';
import type { Clock } from '../ports/Clock';
import type { OfflineCredentialStore, PasswordHasher } from '../ports/Credentials';
import type { DeviceIdentity } from '../ports/DeviceIdentity';
import type { Logger } from '../ports/Logger';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { credentialsSchema, type CredentialsInput, type LoginOutcome } from './LoginUseCase';

/**
 * Offline sign-in against the PBKDF2 verifier stored at the last online login. Allowed only for
 * users who signed in online on this device within `max_offline_hours`, with a failed-attempt
 * lockout of `max_failed_attempts` (reset only by a successful online login).
 */
export class OfflineLoginUseCase {
  private readonly policy = new OfflineLoginPolicy();

  constructor(
    private readonly deps: {
      offlineCredentials: OfflineCredentialStore;
      hasher: PasswordHasher;
      deviceIdentity: DeviceIdentity;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(input: CredentialsInput): Promise<LoginOutcome> {
    const { email, password } = parseOrThrow(credentialsSchema, input, 'Invalid sign-in');
    const d = this.deps;
    const now = d.clock.now();
    const cred = await d.offlineCredentials.get(email);
    try {
      this.policy.assertAllowed(
        cred
          ? {
              lastOnlineAuthAt: cred.lastOnlineAuthAt,
              failedAttempts: cred.failedAttempts,
              maxOfflineHours: cred.policy.maxOfflineHours,
              maxFailedAttempts: cred.policy.maxFailedAttempts,
            }
          : null,
        now,
      );
    } catch (e) {
      d.logger.security('Offline login refused', { reason: e instanceof Error ? e.name : 'unknown' });
      throw e;
    }
    if (!cred) throw new InvalidCredentialsError(); // unreachable: policy already refused

    const ok = await d.hasher.verify(password, cred.verifier);
    if (!ok) {
      const failed = cred.failedAttempts + 1;
      await d.offlineCredentials.updateFailedAttempts(email, failed);
      d.logger.security('Offline login failed', { failedAttempts: failed });
      await d.uow.run((r) =>
        r.audit.append(auditEvent('LOGIN_FAILED', now, cred.user.uuid, null, { mode: 'OFFLINE', failedAttempts: failed })),
      );
      if (failed >= cred.policy.maxFailedAttempts) throw new AccountLockedError();
      throw new InvalidCredentialsError(
        `Incorrect password. ${String(cred.policy.maxFailedAttempts - failed)} attempt(s) left before offline lockout.`,
      );
    }
    if (cred.failedAttempts !== 0) await d.offlineCredentials.updateFailedAttempts(email, 0);

    const device = await d.deviceIdentity.getRegisteredDevice();
    if (!device) throw new DeviceNotRegisteredError();

    await d.uow.run((r) =>
      r.audit.append(auditEvent('LOGIN', now, cred.user.uuid, { type: 'user', uuid: cred.user.uuid }, { mode: 'OFFLINE' })),
    );
    d.logger.audit('User signed in offline', { userUuid: cred.user.uuid });
    d.session.update({ user: cred.user, authMode: 'OFFLINE', device });
    return { kind: 'SIGNED_IN', user: cred.user, mode: 'OFFLINE' };
  }
}
