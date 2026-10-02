import { PaymentFailedError } from '../../errors/DomainError';
import type { Payment } from '../../entities/Sale';
import type { PaymentInput, PaymentMethod } from './PaymentMethod';

/** Shared rules for non-cash tenders: tendered = amount, change = 0, reference required. */
abstract class NonCashPayment implements PaymentMethod {
  abstract readonly code: string;
  abstract readonly label: string;
  readonly requiresReference = true;
  readonly producesChange = false;
  readonly maxPerSale: number | null = null;

  createPayment(input: PaymentInput, remainingDue: number): Payment {
    if (!Number.isSafeInteger(input.tendered) || input.tendered <= 0) {
      throw new PaymentFailedError('INVALID_AMOUNT', `Enter the ${this.label} amount.`);
    }
    if (input.tendered > remainingDue) {
      throw new PaymentFailedError('OVERPAYMENT', `${this.label} amount cannot exceed the balance due.`);
    }
    const payment: Payment = {
      uuid: input.uuid,
      method: this.code,
      amount: input.tendered,
      tendered: input.tendered,
      change: 0,
      reference: input.reference?.trim() ?? null,
    };
    this.validate(payment);
    return payment;
  }

  validate(p: Payment): void {
    if (!Number.isSafeInteger(p.amount) || p.amount <= 0) {
      throw new PaymentFailedError('INVALID_AMOUNT', `Invalid ${this.label} amount.`);
    }
    if (p.tendered !== p.amount || p.change !== 0) {
      throw new PaymentFailedError('INVALID_AMOUNT', `${this.label} cannot produce change.`);
    }
    if (!p.reference || p.reference.trim().length === 0 || p.reference.length > 100) {
      throw new PaymentFailedError('REFERENCE_REQUIRED', `${this.label} reference number is required.`);
    }
  }
}

export class GCashPayment extends NonCashPayment {
  readonly code = 'GCASH';
  readonly label = 'GCash';
}

export class CardPayment extends NonCashPayment {
  readonly code = 'CARD';
  readonly label = 'Card';
}
