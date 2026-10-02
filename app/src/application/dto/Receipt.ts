export interface ReceiptLine {
  readonly name: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineGross: number;
  readonly lineDiscount: number;
  readonly lineTotal: number;
}

export interface ReceiptPayment {
  readonly label: string;
  readonly amount: number;
  readonly tendered: number;
  readonly change: number;
  readonly reference: string | null;
}

/** Printer-agnostic receipt model built by PrintReceiptUseCase and rendered by ReceiptFormatter. */
export interface Receipt {
  readonly headerLines: readonly string[];
  readonly receiptNumber: string;
  readonly createdAt: string;
  readonly cashierName: string;
  readonly deviceCode: string;
  readonly lines: readonly ReceiptLine[];
  readonly subtotal: number;
  readonly discountTotal: number;
  readonly total: number;
  readonly taxTotal: number;
  readonly taxRateBp: number;
  readonly payments: readonly ReceiptPayment[];
  readonly change: number;
  readonly footerLines: readonly string[];
  readonly isReprint: boolean;
  readonly isVoided: boolean;
  readonly openDrawer: boolean;
}
