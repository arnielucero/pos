import type { TransactionalRepositories, UnitOfWork } from '../../domain/repositories/UnitOfWork';
import type { SqlDatabase, SqlExecutor } from '../database/SqlDatabase';
import {
  SqliteApproverRepository,
  SqliteAuditLogRepository,
  SqliteRegisterSessionRepository,
  SqliteSettingsRepository,
  SqliteUserRepository,
} from './SqliteMiscRepositories';
import { SqliteInventoryRepository } from './SqliteInventoryRepository';
import { SqliteProductRepository } from './SqliteProductRepository';
import { SqliteReceiptCounter, SqliteSaleRepository } from './SqliteSaleRepository';
import { SqliteSyncConflictRepository, SqliteSyncQueue } from './SqliteSyncQueue';

export type RepositoryFactory = (executor: SqlExecutor) => TransactionalRepositories;

/** Builds the full repository set over any executor (the database itself or a transaction). */
export const createSqliteRepositories: RepositoryFactory = (ex) => {
  const products = new SqliteProductRepository(ex);
  const sales = new SqliteSaleRepository(ex);
  return {
    productReader: products,
    productWriter: products,
    saleReader: sales,
    saleWriter: sales,
    receiptCounter: new SqliteReceiptCounter(ex),
    inventory: new SqliteInventoryRepository(ex),
    syncQueue: new SqliteSyncQueue(ex),
    conflicts: new SqliteSyncConflictRepository(ex),
    registers: new SqliteRegisterSessionRepository(ex),
    approvers: new SqliteApproverRepository(ex),
    settings: new SqliteSettingsRepository(ex),
    audit: new SqliteAuditLogRepository(ex),
    users: new SqliteUserRepository(ex),
  };
};

export class SqliteUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: SqlDatabase,
    private readonly factory: RepositoryFactory = createSqliteRepositories,
  ) {}

  run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(this.factory(tx)));
  }
}
