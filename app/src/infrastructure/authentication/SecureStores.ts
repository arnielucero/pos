import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { SecureStore } from '../../application/ports/SecureStore';

/** Android Keystore-backed storage (AES key in the hardware-backed Keystore). */
export class NativeSecureStore implements SecureStore {
  private ready: Promise<void> | null = null;

  private init(): Promise<void> {
    this.ready ??= SecureStorage.setKeyPrefix('hmrpos_');
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    await this.init();
    return SecureStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.init();
    await SecureStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.init();
    await SecureStorage.removeItem(key);
  }
}

/**
 * DEV-ONLY fallback for the browser build: sessionStorage is NOT secure storage (readable by
 * any script on the origin, no hardware protection). It exists so the app can run in a
 * desktop browser for development and Playwright E2E. Constructing it with
 * appEnv === 'production' throws.
 */
export class DevSessionSecureStore implements SecureStore {
  constructor(appEnv: string) {
    if (appEnv === 'production') {
      throw new Error('DevSessionSecureStore is DEV-ONLY and refused in production builds');
    }
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(sessionStorage.getItem(`devsecure.${key}`));
  }

  set(key: string, value: string): Promise<void> {
    sessionStorage.setItem(`devsecure.${key}`, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    sessionStorage.removeItem(`devsecure.${key}`);
    return Promise.resolve();
  }
}

/** In-memory store for unit/integration tests. */
export class MemorySecureStore implements SecureStore {
  readonly data = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}
