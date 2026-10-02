import type { RegisterReport, RegisterSession } from '../entities/Register';

export interface SessionSaleFigures {
  readonly status: 'COMPLETED' | 'VOIDED';
  readonly total: number;
  readonly subtotal: number;
  readonly payments: readonly { method: string; amount: number }[];
}

/**
 * X/Z report maths, aligned with the backend's CLOSE_REGISTER recomputation:
 * `cash_sales` = cash *amount applied* (not tendered — change never stays in the drawer) of the
 * session's NON-voided sales (a voided sale's cash is handed back, so it is simply excluded);
 * `cash_refunds` = 0 (refunds are out of scope for v1);
 * expected_cash = opening_cash + cash_sales − cash_refunds + cash_adjustments.
 */
export class RegisterReportCalculator {
  compute(
    kind: 'X' | 'Z',
    session: RegisterSession,
    sales: readonly SessionSaleFigures[],
    generatedAt: string,
    actualCash: number | null,
    cashAdjustments = 0,
  ): RegisterReport {
    let cashSales = 0;
    const cashRefunds = 0;
    let grossSales = 0;
    let netSales = 0;
    let voidCount = 0;
    const byMethod: Record<string, number> = {};
    for (const s of sales) {
      const cash = s.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amount, 0);
      grossSales += s.total;
      if (s.status === 'VOIDED') {
        voidCount += 1;
      } else {
        cashSales += cash;
        netSales += s.total;
        for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
      }
    }
    const expectedCash = session.openingCash + cashSales - cashRefunds + cashAdjustments;
    return {
      kind,
      sessionUuid: session.uuid,
      openedAt: session.openedAt,
      generatedAt,
      openingCash: session.openingCash,
      cashSales,
      cashRefunds,
      cashAdjustments,
      expectedCash,
      actualCash,
      variance: actualCash === null ? null : actualCash - expectedCash,
      salesCount: sales.length - voidCount,
      voidCount,
      grossSales,
      netSales,
      paymentsByMethod: byMethod,
    };
  }
}
