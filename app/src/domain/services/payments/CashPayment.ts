import { PaymentFailedError } from '../../errors/DomainError';
import type { Payment } from '../../entities/Sale';
import type { PaymentInput, PaymentMethod } from './PaymentMethod';

export class CashPayment implements PaymentMethod {
  readonly code = 'CASH';
  readonly label = 'Cash';
  readonly requiresReference = false;
  readonly producesChange = true;
  readonly maxPerSale = 1;

  createPayment(input: PaymentInput, remainingDue: number): Payment {
    if (!Number.isSafeInteger(input.tendered) || input.tendered <= 0) {
      throw new PaymentFailedError('INVALID_AMOUNT', 'Enter the cash amount received.');
    }
    const amount = Math.min(input.tendered, remainingDue);
    const payment: Payment = {
      uuid: input.uuid,
      method: this.code,
      amount,
      tendered: input.tendered,
      change: input.tendered - amount,
      reference: null,
    };
    this.validate(payment);
    return payment;
  }

  validate(p: Payment): void {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0 || !Number.isSafeInteger(p.tendered)) {
      throw new PaymentFailedError('INVALID_AMOUNT', 'Invalid cash amount.');
    }
    if (p.tendered < p.amount) {
      throw new PaymentFailedError('INSUFFICIENT_TENDERED', 'Cash received is less than the amount due.');
    }
    if (p.change !== p.tendered - p.amount) {
      throw new PaymentFailedError('INVALID_AMOUNT', 'Cash change does not match tendered minus amount.');
    }
  }
}
