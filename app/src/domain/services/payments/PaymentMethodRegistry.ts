import { PaymentFailedError } from '../../errors/DomainError';
import type { PaymentMethod } from './PaymentMethod';
import { CashPayment } from './CashPayment';
import { CardPayment, GCashPayment } from './NonCashPayment';

export class PaymentMethodRegistry {
  private readonly methods = new Map<string, PaymentMethod>();

  register(method: PaymentMethod): this {
    if (this.methods.has(method.code)) throw new Error(`Payment method ${method.code} already registered`);
    this.methods.set(method.code, method);
    return this;
  }

  get(code: string): PaymentMethod {
    const m = this.methods.get(code);
    if (!m) throw new PaymentFailedError('UNKNOWN_METHOD', `Payment method ${code} is not supported.`);
    return m;
  }

  has(code: string): boolean {
    return this.methods.has(code);
  }

  list(): readonly PaymentMethod[] {
    return [...this.methods.values()];
  }

  static withDefaults(): PaymentMethodRegistry {
    return new PaymentMethodRegistry().register(new CashPayment()).register(new GCashPayment()).register(new CardPayment());
  }
}
