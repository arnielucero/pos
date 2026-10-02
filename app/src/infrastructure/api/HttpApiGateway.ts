import type {
  AuthGateway,
  DeviceGateway,
  HealthGateway,
  LoginResult,
  PullResponse,
  PushResponse,
  RegisterDeviceRequest,
  SyncGateway,
  SyncOperationRequest,
} from '../../application/ports/Gateways';
import type { StoreSettings } from '../../domain/entities/Settings';
import type { DeviceInfo } from '../../domain/entities/User';
import type { HttpClient } from './HttpClient';
import {
  healthSchema,
  loginResponseSchema,
  pullResponseSchema,
  pushResponseSchema,
  registerDeviceResponseSchema,
  type LoginResponseDto,
} from './schemas';

function mapLogin(res: LoginResponseDto): LoginResult {
  return {
    tokens: {
      accessToken: res.access_token,
      accessExpiresAt: res.access_expires_at,
      refreshToken: res.refresh_token,
      refreshExpiresAt: res.refresh_expires_at,
    },
    user: res.user,
    device: res.device
      ? { uuid: res.device.uuid, code: res.device.code, status: res.device.status, name: res.device.name, storeUuid: res.device.store_uuid }
      : null,
    offlinePolicy: {
      maxOfflineHours: res.offline_policy.max_offline_hours,
      maxFailedAttempts: res.offline_policy.max_failed_attempts,
    },
    serverTime: res.server_time,
  };
}

/** Maps the snake_case HTTP API (docs/API.md) to the application's gateway ports. */
export class HttpApiGateway implements AuthGateway, DeviceGateway, SyncGateway, HealthGateway {
  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const res = await this.http.request('POST', '/auth/login', {
      auth: false,
      body: { email, password },
      schema: loginResponseSchema,
    });
    return mapLogin(res);
  }

  async logout(): Promise<void> {
    await this.http.request('POST', '/auth/logout', { schema: null, timeoutMs: 5000 });
  }

  async register(req: RegisterDeviceRequest): Promise<DeviceInfo> {
    const res = await this.http.request('POST', '/devices/register', {
      body: { device_uuid: req.deviceUuid, device_name: req.deviceName, device_type: req.deviceType },
      schema: registerDeviceResponseSchema,
    });
    return { uuid: res.data.uuid, code: res.data.code, status: res.data.status, name: res.data.name, storeUuid: res.data.store_uuid };
  }

  async push(operations: readonly SyncOperationRequest[], signal?: AbortSignal): Promise<PushResponse> {
    const res = await this.http.request('POST', '/sync', {
      body: {
        operations: operations.map((o) => ({ idempotency_key: o.idempotencyKey, type: o.type, payload: o.payload })),
      },
      schema: pushResponseSchema,
      signal,
      timeoutMs: 45_000,
    });
    return {
      serverTime: res.server_time,
      results: res.results.map((r) => ({
        idempotencyKey: r.idempotency_key,
        status: r.status,
        originalStatus: r.original_status ?? null,
        httpStatus: r.http_status ?? null,
        entityUuid: r.entity_uuid ?? null,
        serverId: r.server_id ?? null,
        conflicts: (r.conflicts ?? []).map((c) => ({
          type: c.type,
          entityType: c.entity_type ?? null,
          entityUuid: c.entity_uuid ?? null,
          localValue: c.local_value,
          serverValue: c.server_value,
          message: c.message ?? null,
        })),
        error: r.error ?? null,
        retryable: r.retryable,
      })),
    };
  }

  async pull(since: string | null, page: number, signal?: AbortSignal): Promise<PullResponse> {
    const qs = new URLSearchParams({ page: String(page) });
    if (since) qs.set('since', since);
    const res = await this.http.request('GET', `/sync/pull?${qs.toString()}`, { schema: pullResponseSchema, signal, timeoutMs: 60_000 });
    const s = res.settings;
    const settings: Partial<StoreSettings> | null = s
      ? {
          ...(s.tax_rate_bp !== undefined && { taxRateBp: s.tax_rate_bp }),
          ...(s.currency !== undefined && { currency: s.currency }),
          ...(s.receipt_header !== undefined && { receiptHeader: s.receipt_header }),
          ...(s.receipt_footer !== undefined && { receiptFooter: s.receipt_footer }),
          ...(s.max_discount_bp !== undefined && { maxDiscountBp: s.max_discount_bp }),
          ...(s.offline_max_hours !== undefined && { offlineMaxHours: s.offline_max_hours }),
        }
      : null;
    return {
      serverTime: res.server_time,
      hasMore: res.has_more,
      products: res.products.map((p) => ({
        uuid: p.uuid,
        sku: p.sku,
        barcode: p.barcode ?? null,
        name: p.name,
        category: p.category ?? null,
        price: p.price,
        isActive: p.is_active,
        trackStock: p.track_stock,
        updatedAt: p.updated_at,
        deleted: p.deleted,
      })),
      inventory: res.inventory.map((i) => ({ productUuid: i.product_uuid, quantityOnHand: i.quantity_on_hand, updatedAt: i.updated_at })),
      approvers: res.approvers.map((a) => ({
        userUuid: a.user_uuid,
        name: a.name,
        permissions: a.permissions,
        pinHash: a.pin_hash,
        isActive: a.is_active,
      })),
      settings,
    };
  }

  async check(timeoutMs: number): Promise<boolean> {
    try {
      const res = await this.http.request('GET', '/health', { auth: false, schema: healthSchema, timeoutMs });
      return res.status === 'ok';
    } catch {
      return false;
    }
  }
}
