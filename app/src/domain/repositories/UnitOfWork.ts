import type { ApproverRepository } from './ApproverRepository';
import type { AuditLogRepository } from './AuditLogRepository';
import type { InventoryRepository } from './InventoryRepository';
import type { ProductReader, ProductWriter } from './ProductRepository';
import type { RegisterSessionRepository } from './RegisterSessionRepository';
import type { ReceiptCounter, SaleReader, SaleWriter } from './SaleRepository';
import type { SettingsRepository } from './SettingsRepository';
import type { SyncConflictRepository, SyncQueue } from './SyncQueue';
import type { UserRepository } from './UserRepository';

/** Repositories bound to a single database transaction. */
export interface TransactionalRepositories {
  readonly productReader: ProductReader;
  readonly productWriter: ProductWriter;
  readonly saleReader: SaleReader;
  readonly saleWriter: SaleWriter;
  readonly receiptCounter: ReceiptCounter;
  readonly inventory: InventoryRepository;
  readonly syncQueue: SyncQueue;
  readonly conflicts: SyncConflictRepository;
  readonly registers: RegisterSessionRepository;
  readonly approvers: ApproverRepository;
  readonly settings: SettingsRepository;
  readonly audit: AuditLogRepository;
  readonly users: UserRepository;
}

/**
 * Runs `work` inside ONE database transaction: either everything it wrote is committed, or
 * (on any thrown error) nothing is.
 */
export interface UnitOfWork {
  run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T>;
}
