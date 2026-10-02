import type { Product } from '../../domain/entities/Product';
import type { StoreSettings } from '../../domain/entities/Settings';
import type { SyncOperationType } from '../../domain/entities/Sync';
import type { DeviceInfo, OfflinePolicy, UserProfile } from '../../domain/entities/User';
import type { ServerApprover } from '../../domain/repositories/ApproverRepository';
import type { ServerBalance } from '../../domain/repositories/InventoryRepository';

export interface AuthTokens {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

export interface LoginResult {
  readonly tokens: AuthTokens;
  readonly user: UserProfile;
  readonly device: DeviceInfo | null;
  readonly offlinePolicy: OfflinePolicy;
  readonly serverTime: string;
}

export interface AuthGateway {
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
}

export interface RegisterDeviceRequest {
  readonly deviceUuid: string;
  readonly deviceName: string;
  readonly deviceType: 'ANDROID_TABLET';
}

export interface DeviceGateway {
  register(request: RegisterDeviceRequest): Promise<DeviceInfo>;
}

export interface SyncOperationRequest {
  readonly idempotencyKey: string;
  readonly type: SyncOperationType;
  readonly payload: unknown;
}

export type SyncResultStatus = 'APPLIED' | 'DUPLICATE' | 'FLAGGED' | 'REJECTED';

export interface SyncResultConflict {
  readonly type: string;
  readonly entityType: string | null;
  readonly entityUuid: string | null;
  readonly localValue: unknown;
  readonly serverValue: unknown;
  readonly message: string | null;
}

export interface SyncOperationResult {
  readonly idempotencyKey: string;
  readonly status: SyncResultStatus;
  /** For DUPLICATE results: the status of the original application (APPLIED | FLAGGED). */
  readonly originalStatus: SyncResultStatus | null;
  readonly httpStatus: number | null;
  readonly entityUuid: string | null;
  readonly serverId: number | null;
  readonly conflicts: readonly SyncResultConflict[];
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly retryable: boolean;
}

export interface PushResponse {
  readonly results: readonly SyncOperationResult[];
  readonly serverTime: string;
}

export interface PullResponse {
  readonly serverTime: string;
  readonly hasMore: boolean;
  readonly products: readonly Product[];
  readonly inventory: readonly ServerBalance[];
  readonly approvers: readonly ServerApprover[];
  readonly settings: Partial<StoreSettings> | null;
}

export interface SyncGateway {
  push(operations: readonly SyncOperationRequest[], signal?: AbortSignal): Promise<PushResponse>;
  pull(since: string | null, page: number, signal?: AbortSignal): Promise<PullResponse>;
}

export interface HealthGateway {
  /** Resolves true when GET /health answered {status:"ok"} within the timeout. */
  check(timeoutMs: number): Promise<boolean>;
}
