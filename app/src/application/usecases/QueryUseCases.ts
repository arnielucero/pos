import type { InventoryMovement } from '../../domain/entities/Inventory';
import type { Sale, SaleSummary } from '../../domain/entities/Sale';
import type { AuditEvent } from '../../domain/entities/Audit';
import type { SyncConflict, SyncCounts, SyncQueueItem } from '../../domain/entities/Sync';
import { hasPermission } from '../../domain/entities/Permission';
import { PermissionDeniedError } from '../../domain/errors/DomainError';
import type { AuditLogRepository } from '../../domain/repositories/AuditLogRepository';
import type { InventoryRepository } from '../../domain/repositories/InventoryRepository';
import type { SaleListQuery, SaleReader } from '../../domain/repositories/SaleRepository';
import type { SyncConflictRepository, SyncQueue } from '../../domain/repositories/SyncQueue';
import type { SessionManager } from '../session/SessionManager';

/** Read-side queries for transaction history. */
export class TransactionHistoryUseCase {
  constructor(private readonly sales: SaleReader) {}

  list(query: SaleListQuery): Promise<readonly SaleSummary[]> {
    return this.sales.list(query);
  }

  count(query: Omit<SaleListQuery, 'limit' | 'offset'>): Promise<number> {
    return this.sales.count(query);
  }

  get(uuid: string): Promise<Sale | null> {
    return this.sales.findByUuid(uuid);
  }
}

export class InventoryQueryUseCase {
  constructor(private readonly inventory: InventoryRepository) {}

  movements(productUuid: string): Promise<readonly InventoryMovement[]> {
    return this.inventory.listMovements(productUuid, 50);
  }
}

export interface SyncDiagnostics {
  readonly failed: readonly SyncQueueItem[];
  readonly pending: readonly SyncQueueItem[];
  readonly conflicts: readonly SyncConflict[];
  readonly audit: readonly AuditEvent[];
}

export class SyncStatusUseCase {
  constructor(
    private readonly deps: {
      queue: SyncQueue;
      conflicts: SyncConflictRepository;
      audit: AuditLogRepository;
      session: SessionManager;
    },
  ) {}

  counts(): Promise<SyncCounts> {
    return this.deps.queue.counts();
  }

  canViewDiagnostics(): boolean {
    return hasPermission(this.deps.session.getState().user, 'sync.diagnostics');
  }

  /** Detailed diagnostics (failed ops, conflicts) — only for `sync.diagnostics`. */
  async diagnostics(): Promise<SyncDiagnostics> {
    if (!this.canViewDiagnostics()) throw new PermissionDeniedError('sync.diagnostics');
    const [failed, pending, conflicts, audit] = await Promise.all([
      this.deps.queue.list('FAILED', 100),
      this.deps.queue.list('PENDING', 100),
      this.deps.conflicts.list(100),
      this.deps.audit.recent(50),
    ]);
    return { failed, pending, conflicts, audit };
  }

  /** Manager action: put a FAILED operation back in the queue (same idempotency key/payload). */
  async requeue(id: number): Promise<void> {
    if (!this.canViewDiagnostics()) throw new PermissionDeniedError('sync.diagnostics');
    await this.deps.queue.requeueFailed(id);
  }
}
