import { isRemoteCallError } from '../ports/RemoteCallError';
import type { NetworkStatusProvider } from '../ports/Network';
import type { CredentialsInput, LoginOutcome, LoginUseCase } from './LoginUseCase';
import type { OfflineLoginUseCase } from './OfflineLoginUseCase';

/**
 * Chooses online or offline sign-in: online when the API is reachable; falls back to offline
 * verification only when the online attempt fails for network reasons (never on
 * INVALID_CREDENTIALS, which is authoritative).
 */
export class SignInUseCase {
  constructor(
    private readonly online: LoginUseCase,
    private readonly offline: OfflineLoginUseCase,
    private readonly network: NetworkStatusProvider,
  ) {}

  async execute(input: CredentialsInput): Promise<LoginOutcome> {
    if (this.network.current() === 'OFFLINE') return this.offline.execute(input);
    try {
      return await this.online.execute(input);
    } catch (e) {
      if (isRemoteCallError(e) && (e.isNetworkFailure || (e.retryable && e.httpStatus !== 429))) {
        return this.offline.execute(input);
      }
      throw e;
    }
  }
}
