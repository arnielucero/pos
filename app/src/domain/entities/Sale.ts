import type { Approval } from './Approval';

export type DiscountType = 'PERCENT' | 'AMOUNT';

export interface Discount {
  readonly type: DiscountType;
  /** PERCENT → basis points; AMOUNT → centavos. */
  readonly value: number;
}

export interface ApprovedDiscount extends Discount {
  readonly approval: Approval | null;
}

export type SaleStatus = 'COMPLETED' | 'VOIDED';
export type SalePaymentStatus = 'PAID';
export type SaleSyncStatus = 'PENDING' | 'SYNCED' | 'FLAGGED' | 'FAILED';
export type PrintStatus = 'PENDING' | 'PRINTED' | 'FAILED';

export interface SaleItem {
  readonly uuid: string;
  readonly productUuid: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly discount: ApprovedDiscount | null;
  readonly lineGross: number;
  readonly lineDiscount: number;
  readonly lineTotal: number;
}

export interface Payment {
  readonly uuid: string;
  readonly method: string;
  readonly amount: number;
  readonly tendered: number;
  readonly change: number;
  readonly reference: string | null;
}

export interface Sale {
  readonly uuid: string;
  readonly receiptNumber: string;
  readonly serverId: number | null;
  readonly cashierUuid: string;
  readonly cashierName: string;
  readonly storeUuid: string;
  readonly deviceUuid: string;
  readonly registerSessionUuid: string;
  readonly subtotal: number;
  readonly orderDiscount: ApprovedDiscount | null;
  readonly orderDiscountAmount: number;
  readonly discountTotal: number;
  readonly taxTotal: number;
  readonly total: number;
  readonly status: SaleStatus;
  readonly paymentStatus: SalePaymentStatus;
  readonly syncStatus: SaleSyncStatus;
  readonly printStatus: PrintStatus;
  readonly catalogSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly items: readonly SaleItem[];
  readonly payments: readonly Payment[];
}

export type SaleSummary = Omit<Sale, 'items' | 'payments'>;
