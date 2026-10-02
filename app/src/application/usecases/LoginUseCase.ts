import { z } from 'zod';
import { hasPermission } from '../../domain/entities/Permission';
import type { UserProfile } from '../../domain/entities/User';
import { DeviceNotRegisteredError } from '../../domain/errors/DomainError';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import type { Clock } from '../ports/Clock';
import type { OfflineCredentialStore, PasswordHasher, TokenStore } from '../ports/Credentials';
import type { DeviceIdentity } from '../ports/DeviceIdentity';
import type { AuthGateway } from '../ports/Gateways';
import type { Logger } from '../ports/Logger';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required').max(200),
});
export type CredentialsInput = z.input<typeof credentialsSchema>;

export type LoginOutcome =
  | { readonly kind: 'SIGNED_IN'; readonly user: UserProfile; readonly mode: 'ONLINE' | 'OFFLINE' }
  | { readonly kind: 'DEVICE_REGISTRATION_REQUIRED'; readonly user: UserProfile };

/** How many distinct users may sign in offline on one device (most recent online logins). */
export const MAX_OFFLINE_USERS = 5;

export class LoginUseCase {
  constructor(
    private readonly deps: {
      auth: AuthGateway;
      tokens: TokenStore;
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
    const result = await d.auth.login(email, password);
    await d.tokens.save(result.tokens);
    const now = d.clock.now();

    // Offline verifier: PBKDF2 of the password (never the password itself), in secure storage.
    const verifier = await d.hasher.createVerifier(password);
    await d.offlineCredentials.save(
      {
        email,
        user: result.user,
        verifier,
        lastOnlineAuthAt: now.toISOString(),
        failedAttempts: 0,
        policy: result.offlinePolicy,
      },
      MAX_OFFLINE_USERS,
    );

    if (result.device) await d.deviceIdentity.saveRegisteredDevice(result.device);

    await d.uow.run(async (r) => {
      await r.users.upsertStore(result.user.store);
      await r.users.upsert(result.user);
      await r.settings.set('server_time_offset_ms', String(Date.parse(result.serverTime) - now.getTime()));
      await r.audit.append(
        auditEvent('LOGIN', now, result.user.uuid, { type: 'user', uuid: result.user.uuid }, { mode: 'ONLINE' }),
      );
    });
    d.logger.audit('User signed in online', { userUuid: result.user.uuid });

    if (!result.device) {
      if (!hasPermission(result.user, 'device.register')) {
        // Server should already have answered 403; be defensive anyway.
        await d.tokens.clear();
        throw new DeviceNotRegisteredError();
      }
      d.session.update({ user: result.user, authMode: 'ONLINE', device: null, reauthRequired: false });
      return { kind: 'DEVICE_REGISTRATION_REQUIRED', user: result.user };
    }
    d.session.update({ user: result.user, authMode: 'ONLINE', device: result.device, reauthRequired: false });
    return { kind: 'SIGNED_IN', user: result.user, mode: 'ONLINE' };
  }
}
