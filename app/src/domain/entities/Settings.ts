export type StockPolicy = 'BLOCK' | 'WARN';

export interface StoreSettings {
  readonly taxRateBp: number;
  readonly currency: string;
  readonly receiptHeader: string;
  readonly receiptFooter: string;
  readonly maxDiscountBp: number;
  readonly offlineMaxHours: number;
  readonly stockPolicy: StockPolicy;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  taxRateBp: 1200,
  currency: 'PHP',
  receiptHeader: 'HMR POS',
  receiptFooter: 'Thank you!',
  maxDiscountBp: 5000,
  offlineMaxHours: 72,
  stockPolicy: 'BLOCK',
};
