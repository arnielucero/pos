import type { Approver } from '../../domain/entities/Approval';
import type { AuditEvent } from '../../domain/entities/Audit';
import type { RegisterSession } from '../../domain/entities/Register';
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from '../../domain/entities/Settings';
import type { StoreRef, UserProfile } from '../../domain/entities/User';
import type { ApproverRepository, ServerApprover } from '../../domain/repositories/ApproverRepository';
import type { AuditLogRepository } from '../../domain/repositories/AuditLogRepository';
import type { RegisterCloseData, RegisterSessionRepository } from '../../domain/repositories/RegisterSessionRepository';
import type { SettingsRepository } from '../../domain/repositories/SettingsRepository';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import type { SqlExecutor, SqlRow } from '../database/SqlDatabase';
import { bool, int, intOrNull, isRecord, isStringArray, jsonOr, str, strOrNull } from './rowMapping';

function mapSession(r: SqlRow): RegisterSession {
  return {
    uuid: str(r, 'uuid'),
    deviceUuid: str(r, 'device_uuid'),
    storeUuid: str(r, 'store_uuid'),
    openedByUuid: str(r, 'opened_by_uuid'),
    openedAt: str(r, 'opened_at'),
    openingCash: int(r, 'opening_cash'),
    status: str(r, 'status') === 'CLOSED' ? 'CLOSED' : 'OPEN',
    closedAt: strOrNull(r, 'closed_at'),
    closedByUuid: strOrNull(r, 'closed_by_uuid'),
    actualCash: intOrNull(r, 'actual_cash'),
    expectedCash: intOrNull(r, 'expected_cash'),
    cashSales: intOrNull(r, 'cash_sales'),
    cashRefunds: intOrNull(r, 'cash_refunds'),
    cashAdjustments: intOrNull(r, 'cash_adjustments'),
    variance: intOrNull(r, 'variance'),
  };
}

export class SqliteRegisterSessionRepository implements RegisterSessionRepository {
  constructor(private readonly db: SqlExecutor) {}

  async findOpen(deviceUuid: string): Promise<RegisterSession | null> {
    const rows = await this.db.query(
      `SELECT * FROM register_sessions WHERE device_uuid = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`,
      [deviceUuid],
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async findByUuid(uuid: string): Promise<RegisterSession | null> {
    const rows = await this.db.query(`SELECT * FROM register_sessions WHERE uuid = ?`, [uuid]);
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async insert(s: RegisterSession): Promise<void> {
    await this.db.execute(
      `INSERT INTO register_sessions (uuid, device_uuid, store_uuid, opened_by_uuid, opened_at, opening_cash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.uuid, s.deviceUuid, s.storeUuid, s.openedByUuid, s.openedAt, s.openingCash, s.status],
    );
  }

  async close(uuid: string, d: RegisterCloseData): Promise<void> {
    await this.db.execute(
      `UPDATE register_sessions SET status = 'CLOSED', closed_at = ?, closed_by_uuid = ?, actual_cash = ?, expected_cash = ?,
        cash_sales = ?, cash_refunds = ?, cash_adjustments = ?, variance = ? WHERE uuid = ? AND status = 'OPEN'`,
      [d.closedAt, d.closedByUuid, d.actualCash, d.expectedCash, d.cashSales, d.cashRefunds, d.cashAdjustments, d.variance, uuid],
    );
  }
}

function mapApprover(r: SqlRow): Approver {
  return {
    userUuid: str(r, 'user_uuid'),
    name: str(r, 'name'),
    permissions: jsonOr(r, 'permissions', [], isStringArray),
    pinHash: str(r, 'pin_hash'),
    isActive: bool(r, 'is_active'),
    failedAttempts: int(r, 'failed_attempts'),
    lockedUntil: strOrNull(r, 'locked_until'),
  };
}

export class SqliteApproverRepository implements ApproverRepository {
  constructor(private readonly db: SqlExecutor) {}

  async listActive(): Promise<readonly Approver[]> {
    const rows = await this.db.query(`SELECT * FROM approvers WHERE is_active = 1 ORDER BY name`);
    return rows.map(mapApprover);
  }

  async findByUuid(uuid: string): Promise<Approver | null> {
    const rows = await this.db.query(`SELECT * FROM approvers WHERE user_uuid = ?`, [uuid]);
    return rows[0] ? mapApprover(rows[0]) : null;
  }

  async upsertMany(approvers: readonly ServerApprover[]): Promise<void> {
    const ts = new Date().toISOString();
    for (const a of approvers) {
      await this.db.execute(
        `INSERT INTO approvers (user_uuid, name, permissions, pin_hash, is_active, failed_attempts, locked_until, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
         ON CONFLICT (user_uuid) DO UPDATE SET name = excluded.name, permissions = excluded.permissions,
           pin_hash = excluded.pin_hash, is_active = excluded.is_active, updated_at = excluded.updated_at`,
        [a.userUuid, a.name, JSON.stringify(a.permissions), a.pinHash, a.isActive ? 1 : 0, ts],
      );
    }
  }

  async updateAttempts(uuid: string, failedAttempts: number, lockedUntil: string | null): Promise<void> {
    await this.db.execute(`UPDATE approvers SET failed_attempts = ?, locked_until = ? WHERE user_uuid = ?`, [
      failedAttempts,
      lockedUntil,
      uuid,
    ]);
  }
}

const STORE_SETTINGS_KEY = 'store.settings';

function isPartialSettings(v: unknown): v is Partial<StoreSettings> {
  return isRecord(v);
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlExecutor) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db.query(`SELECT value FROM settings WHERE key = ?`, [key]);
    return rows[0] ? str(rows[0], 'value') : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()],
    );
  }

  async getStoreSettings(): Promise<StoreSettings> {
    const raw = await this.get(STORE_SETTINGS_KEY);
    if (!raw) return DEFAULT_STORE_SETTINGS;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isPartialSettings(parsed) ? { ...DEFAULT_STORE_SETTINGS, ...parsed } : DEFAULT_STORE_SETTINGS;
    } catch {
      return DEFAULT_STORE_SETTINGS;
    }
  }

  async saveStoreSettings(settings: Partial<StoreSettings>): Promise<void> {
    const current = await this.getStoreSettings();
    await this.set(STORE_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
  }
}

function mapAudit(r: SqlRow): AuditEvent {
  return {
    uuid: str(r, 'uuid'),
    action: str(r, 'action'),
    userUuid: strOrNull(r, 'user_uuid'),
    entityType: strOrNull(r, 'entity_type'),
    entityUuid: strOrNull(r, 'entity_uuid'),
    metadata: jsonOr(r, 'metadata', {}, isRecord),
    occurredAt: str(r, 'occurred_at'),
  };
}

export class SqliteAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: SqlExecutor) {}

  async append(e: AuditEvent): Promise<void> {
    await this.db.execute(
      `INSERT INTO audit_logs (uuid, action, user_uuid, entity_type, entity_uuid, metadata, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [e.uuid, e.action, e.userUuid, e.entityType, e.entityUuid, JSON.stringify(e.metadata), e.occurredAt],
    );
  }

  async takeBatch(batchUuid: string, limit: number): Promise<readonly AuditEvent[]> {
    await this.db.execute(
      `UPDATE audit_logs SET batch_uuid = ? WHERE id IN (SELECT id FROM audit_logs WHERE batch_uuid IS NULL ORDER BY id LIMIT ?)`,
      [batchUuid, limit],
    );
    const rows = await this.db.query(`SELECT * FROM audit_logs WHERE batch_uuid = ? ORDER BY id`, [batchUuid]);
    return rows.map(mapAudit);
  }

  async markBatchUploaded(batchUuid: string): Promise<void> {
    await this.db.execute(`UPDATE audit_logs SET uploaded = 1 WHERE batch_uuid = ?`, [batchUuid]);
  }

  async recent(limit: number): Promise<readonly AuditEvent[]> {
    const rows = await this.db.query(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`, [limit]);
    return rows.map(mapAudit);
  }
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: SqlExecutor) {}

  async upsert(u: UserProfile): Promise<void> {
    await this.db.execute(
      `INSERT INTO users (uuid, name, email, role, permissions, store_uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uuid) DO UPDATE SET name = excluded.name, email = excluded.email, role = excluded.role,
         permissions = excluded.permissions, store_uuid = excluded.store_uuid, updated_at = excluded.updated_at`,
      [u.uuid, u.name, u.email, u.role, JSON.stringify(u.permissions), u.store.uuid, new Date().toISOString()],
    );
  }

  async findByUuid(uuid: string): Promise<UserProfile | null> {
    const rows = await this.db.query(
      `SELECT u.*, s.code AS store_code, s.name AS store_name FROM users u LEFT JOIN stores s ON s.uuid = u.store_uuid WHERE u.uuid = ?`,
      [uuid],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      uuid: str(r, 'uuid'),
      name: str(r, 'name'),
      email: str(r, 'email'),
      role: str(r, 'role'),
      permissions: jsonOr(r, 'permissions', [], isStringArray),
      store: { uuid: strOrNull(r, 'store_uuid') ?? '', code: strOrNull(r, 'store_code') ?? '', name: strOrNull(r, 'store_name') ?? '' },
    };
  }

  async upsertStore(s: StoreRef): Promise<void> {
    await this.db.execute(
      `INSERT INTO stores (uuid, code, name, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (uuid) DO UPDATE SET code = excluded.code, name = excluded.name, updated_at = excluded.updated_at`,
      [s.uuid, s.code, s.name, new Date().toISOString()],
    );
  }
}
