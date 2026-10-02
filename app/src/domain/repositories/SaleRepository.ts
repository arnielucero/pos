import type { PrintStatus, Sale, SaleSummary, SaleSyncStatus } from '../entities/Sale';

export interface SaleListQuery {
  readonly search: string;
  readonly status: 'ALL' | 'COMPLETED' | 'VOIDED';
  readonly syncStatus: 'ALL' | SaleSyncStatus;
  readonly limit: number;
  readonly offset: number;
}

export interface SaleReader {
  findByUuid(uuid: string): Promise<Sale | null>;
  list(query: SaleListQuery): Promise<readonly SaleSummary[]>;
  count(query: Omit<SaleListQuery, 'limit' | 'offset'>): Promise<number>;
  listBySession(sessionUuid: string): Promise<readonly Sale[]>;
}

export interface SaleWriter {
  insert(sale: Sale): Promise<void>;
  markVoided(uuid: string, reason: string, voidedAt: string): Promise<void>;
  updateSyncStatus(uuid: string, status: SaleSyncStatus, serverId?: number | null): Promise<void>;
  updatePrintStatus(uuid: string, status: PrintStatus): Promise<void>;
}

export interface ReceiptCounter {
  /** Next per-device sequence for the given local day (YYYYMMDD). Must run inside the sale transaction. */
  next(day: string): Promise<number>;
}
