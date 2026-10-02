export type RegisterSessionStatus = 'OPEN' | 'CLOSED';

export interface RegisterSession {
  readonly uuid: string;
  readonly deviceUuid: string;
  readonly storeUuid: string;
  readonly openedByUuid: string;
  readonly openedAt: string;
  readonly openingCash: number;
  readonly status: RegisterSessionStatus;
  readonly closedAt: string | null;
  readonly closedByUuid: string | null;
  readonly actualCash: number | null;
  readonly expectedCash: number | null;
  readonly cashSales: number | null;
  readonly cashRefunds: number | null;
  readonly cashAdjustments: number | null;
  readonly variance: number | null;
}

/** X (mid-shift) / Z (closing) report figures. All centavos. */
export interface RegisterReport {
  readonly kind: 'X' | 'Z';
  readonly sessionUuid: string;
  readonly openedAt: string;
  readonly generatedAt: string;
  readonly openingCash: number;
  readonly cashSales: number;
  readonly cashRefunds: number;
  readonly cashAdjustments: number;
  readonly expectedCash: number;
  readonly actualCash: number | null;
  readonly variance: number | null;
  readonly salesCount: number;
  readonly voidCount: number;
  readonly grossSales: number;
  readonly netSales: number;
  readonly paymentsByMethod: Readonly<Record<string, number>>;
}
