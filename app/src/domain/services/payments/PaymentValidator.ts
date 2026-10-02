import { PaymentFailedError } from '../../errors/DomainError';
import type { Payment } from '../../entities/Sale';
import type { PaymentMethodRegistry } from './PaymentMethodRegistry';

/**
 * Validates a full set of payments against a sale total (API.md "Payments"):
 * Σ amount == total exactly; change only from methods that produce change; per-method
 * limits (at most one CASH); payment uuids unique.
 */
export class PaymentValidator {
  constructor(private readonly registry: PaymentMethodRegistry) {}

  validate(total: number, payments: readonly Payment[]): void {
    const seen = new Set<string>();
    const perMethod = new Map<string, number>();
    let sum = 0;
    for (const p of payments) {
      if (seen.has(p.uuid)) throw new PaymentFailedError('DUPLICATE_PAYMENT', 'Duplicate payment detected.');
      seen.add(p.uuid);
      const method = this.registry.get(p.method);
      method.validate(p);
      if (!method.producesChange && p.change !== 0) {
        throw new PaymentFailedError('INVALID_AMOUNT', `${method.label} cannot produce change.`);
      }
      const count = (perMethod.get(p.method) ?? 0) + 1;
      perMethod.set(p.method, count);
      if (method.maxPerSale !== null && count > method.maxPerSale) {
        throw new PaymentFailedError('TOO_MANY_OF_METHOD', `Only ${String(method.maxPerSale)} ${method.label} payment allowed per sale.`);
      }
      sum += p.amount;
    }
    if (sum !== total) {
      throw new PaymentFailedError(
        sum < total ? 'TOTAL_MISMATCH' : 'OVERPAYMENT',
        sum < total ? 'Payments do not cover the total.' : 'Payments exceed the total.',
      );
    }
  }

  /** Remaining balance after the given payments (never negative). */
  static remaining(total: number, payments: readonly Payment[]): number {
    return Math.max(0, total - payments.reduce((s, p) => s + p.amount, 0));
  }
}
