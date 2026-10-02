/**
 * Key/value store for secrets (tokens, offline verifiers, DB passphrase, device identity).
 * Native: Android Keystore-backed. Never SQLite or localStorage.
 */
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
