export type Role = 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'INVENTORY';

export interface StoreRef {
  readonly uuid: string;
  readonly code: string;
  readonly name: string;
}

/** Cached user profile. Never contains a password or token. */
export interface UserProfile {
  readonly uuid: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly store: StoreRef;
}

export interface DeviceInfo {
  readonly uuid: string;
  readonly code: string;
  readonly status: string;
  readonly name?: string | undefined;
  readonly storeUuid?: string | undefined;
}

export interface OfflinePolicy {
  readonly maxOfflineHours: number;
  readonly maxFailedAttempts: number;
}

export type AuthMode = 'ONLINE' | 'OFFLINE';
