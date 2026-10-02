import type { OfflinePolicy, UserProfile } from '../../domain/entities/User';
import type { AuthTokens } from './Gateways';

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  save(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

/** PBKDF2 verifier; the password itself is never stored. */
export interface PasswordVerifier {
  readonly algorithm: 'PBKDF2-SHA256';
  readonly iterations: number;
  readonly salt: string;
  readonly hash: string;
}

export interface PasswordHasher {
  createVerifier(password: string): Promise<PasswordVerifier>;
  verify(password: string, verifier: PasswordVerifier): Promise<boolean>;
}

export interface PinVerifier {
  /** Verifies a PIN against a synced slow hash (bcrypt). Returns false for unsupported hash formats. */
  verify(pin: string, hash: string): Promise<boolean>;
  supports(hash: string): boolean;
}

export interface OfflineCredential {
  readonly email: string;
  readonly user: UserProfile;
  readonly verifier: PasswordVerifier;
  readonly lastOnlineAuthAt: string;
  readonly failedAttempts: number;
  readonly policy: OfflinePolicy;
}

export interface OfflineCredentialStore {
  get(email: string): Promise<OfflineCredential | null>;
  /** Saves and keeps only the most recent `maxUsers` credentials on this device. */
  save(credential: OfflineCredential, maxUsers: number): Promise<void>;
  updateFailedAttempts(email: string, failedAttempts: number): Promise<void>;
  remove(email: string): Promise<void>;
  listEmails(): Promise<readonly string[]>;
}
