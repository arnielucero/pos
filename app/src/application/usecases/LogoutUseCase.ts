import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import type { Clock } from '../ports/Clock';
import type { TokenStore } from '../ports/Credentials';
import type { AuthGateway } from '../ports/Gateways';
import type { Logger } from '../ports/Logger';
import type { NetworkStatusProvider } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';

/** Signs out. Revokes tokens server-side when reachable. Never touches the sync queue. */
export class LogoutUseCase {
  constructor(
    private readonly deps: {
      auth: AuthGateway;
      tokens: TokenStore;
      network: NetworkStatusProvider;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(): Promise<void> {
    const d = this.deps;
    const user = d.session.getState().user;
    if (d.network.current() !== 'OFFLINE' && (await d.tokens.get())) {
      try {
        await d.auth.logout();
      } catch (e) {
        d.logger.warning('Server logout failed; clearing local tokens anyway', { error: String(e) });
      }
    }
    await d.tokens.clear();
    if (user) {
      await d.uow.run((r) => r.audit.append(auditEvent('LOGOUT', d.clock.now(), user.uuid, null)));
    }
    d.session.clearUser();
  }
}
