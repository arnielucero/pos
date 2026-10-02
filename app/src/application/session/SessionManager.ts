import type { RegisterSession } from '../../domain/entities/Register';
import type { AuthMode, DeviceInfo, UserProfile } from '../../domain/entities/User';
import { AuthenticationRequiredError } from '../../domain/errors/DomainError';

export interface SessionState {
  readonly user: UserProfile | null;
  readonly authMode: AuthMode | null;
  readonly device: DeviceInfo | null;
  readonly registerSession: RegisterSession | null;
  /** True when the server rejected our refresh token: sync is paused until an online login. */
  readonly reauthRequired: boolean;
}

const EMPTY: SessionState = { user: null, authMode: null, device: null, registerSession: null, reauthRequired: false };

/** In-memory session (who is signed in, which device, which register). Observable for the UI. */
export class SessionManager {
  private state: SessionState = EMPTY;
  private readonly listeners = new Set<() => void>();

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  clearUser(): void {
    this.update({ user: null, authMode: null, registerSession: null });
  }

  requireUser(): UserProfile {
    const u = this.state.user;
    if (!u) throw new AuthenticationRequiredError('Please sign in.');
    return u;
  }

  requireDevice(): DeviceInfo {
    const d = this.state.device;
    if (!d) throw new AuthenticationRequiredError('This device is not registered.');
    return d;
  }
}
