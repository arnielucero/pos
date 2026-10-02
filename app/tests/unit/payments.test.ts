import { describe, expect, it } from 'vitest';
import type { Payment } from '../../src/domain/entities/Sale';
import { PaymentFailedError } from '../../src/domain/errors/DomainError';
import { CashPayment } from '../../src/domain/services/payments/CashPayment';
import { GCashPayment } from '../../src/domain/services/payments/NonCashPayment';
import type { PaymentInput, PaymentMethod } from '../../src/domain/services/payments/PaymentMethod';
import { PaymentMethodRegistry } from '../../src/domain/services/payments/PaymentMethodRegistry';
import { PaymentValidator } from '../../src/domain/services/payments/PaymentValidator';

const id = (): string => globalThis.crypto.randomUUID();
const registry = PaymentMethodRegistry.withDefaults();
const validator = new PaymentValidator(registry);

function reason(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof PaymentFailedError ? e.reason : 'OTHER';
  }
}

describe('CashPayment', () => {
  const cash = new CashPayment();
  it('exact cash produces no change', () => {
    const p = cash.createPayment({ uuid: id(), tendered: 20600 }, 20600);
    expect(p).toMatchObject({ amount: 20600, tendered: 20600, change: 0 });
  });
  it('excess cash produces change', () => {
    const p = cash.createPayment({ uuid: id(), tendered: 50000 }, 20600);
    expect(p).toMatchObject({ amount: 20600, tendered: 50000, change: 29400 });
  });
  it('insufficient cash becomes a partial payment (rest by another method)', () => {
    const p = cash.createPayment({ uuid: id(), tendered: 10000 }, 20600);
    expect(p).toMatchObject({ amount: 10000, change: 0 });
  });
  it('rejects a cash line whose tendered is below the amount', () => {
    expect(reason(() => { cash.validate({ uuid: id(), method: 'CASH', amount: 1000, tendered: 500, change: 0, reference: null }); })).toBe(
      'INSUFFICIENT_TENDERED',
    );
  });
  it('rejects zero/negative tendered', () => {
    expect(reason(() => cash.createPayment({ uuid: id(), tendered: 0 }, 100))).toBe('INVALID_AMOUNT');
  });
});

describe('Non-cash payments', () => {
  const g = new GCashPayment();
  it('requires a reference number', () => {
    expect(reason(() => g.createPayment({ uuid: id(), tendered: 1000, reference: '' }, 1000))).toBe('REFERENCE_REQUIRED');
  });
  it('cannot exceed the balance (no change from non-cash)', () => {
    expect(reason(() => g.createPayment({ uuid: id(), tendered: 2000, reference: 'R1' }, 1000))).toBe('OVERPAYMENT');
  });
  it('tendered equals amount and change is zero', () => {
    expect(g.createPayment({ uuid: id(), tendered: 1000, reference: 'R1' }, 1000)).toMatchObject({ amount: 1000, tendered: 1000, change: 0 });
  });
});

describe('PaymentValidator', () => {
  const cashLine = (amount: number, tendered: number): Payment => ({ uuid: id(), method: 'CASH', amount, tendered, change: tendered - amount, reference: null });
  const card = (amount: number): Payment => ({ uuid: id(), method: 'CARD', amount, tendered: amount, change: 0, reference: 'APPR-1' });

  it('accepts exact single payment', () => {
    expect(() => {
      validator.validate(20600, [cashLine(20600, 20600)]);
    }).not.toThrow();
  });
  it('accepts excess cash with change', () => {
    expect(() => {
      validator.validate(20600, [cashLine(20600, 50000)]);
    }).not.toThrow();
  });
  it('rejects payments that do not cover the total', () => {
    expect(reason(() => { validator.validate(20600, [cashLine(10000, 10000)]); })).toBe('TOTAL_MISMATCH');
  });
  it('accepts split cash + card', () => {
    expect(() => {
      validator.validate(20600, [cashLine(10000, 10000), card(10600)]);
    }).not.toThrow();
  });
  it('rejects payments exceeding the total', () => {
    expect(reason(() => { validator.validate(20600, [card(10600), card(20000)]); })).toBe('OVERPAYMENT');
  });
  it('rejects duplicate payment uuid', () => {
    const p = card(10300);
    expect(reason(() => { validator.validate(20600, [p, { ...p }]); })).toBe('DUPLICATE_PAYMENT');
  });
  it('rejects more than one CASH payment', () => {
    expect(reason(() => { validator.validate(2000, [cashLine(1000, 1000), cashLine(1000, 1000)]); })).toBe('TOO_MANY_OF_METHOD');
  });
  it('rejects change on a non-cash payment', () => {
    expect(reason(() => { validator.validate(1000, [{ ...card(1000), tendered: 1500, change: 500 }]); })).toBe('INVALID_AMOUNT');
  });
  it('rejects unknown methods', () => {
    expect(reason(() => { validator.validate(1000, [{ ...card(1000), method: 'BITCOIN' }]); })).toBe('UNKNOWN_METHOD');
  });
  it('computes the remaining balance', () => {
    expect(PaymentValidator.remaining(20600, [cashLine(10000, 10000)])).toBe(10600);
    expect(PaymentValidator.remaining(20600, [cashLine(20600, 50000)])).toBe(0);
  });
});

describe('PaymentMethodRegistry extensibility (Open/Closed)', () => {
  class VoucherPayment implements PaymentMethod {
    readonly code = 'VOUCHER';
    readonly label = 'Voucher';
    readonly requiresReference = true;
    readonly producesChange = false;
    readonly maxPerSale = 1;
    createPayment(input: PaymentInput, remaining: number): Payment {
      const p = { uuid: input.uuid, method: this.code, amount: Math.min(input.tendered, remaining), tendered: Math.min(input.tendered, remaining), change: 0, reference: input.reference ?? null };
      this.validate(p);
      return p;
    }
    validate(p: Payment): void {
      if (!p.reference?.startsWith('V-')) throw new PaymentFailedError('REFERENCE_REQUIRED', 'Voucher code required');
    }
  }

  it('accepts a new method without modifying the validator', () => {
    const reg = PaymentMethodRegistry.withDefaults().register(new VoucherPayment());
    const v = new PaymentValidator(reg);
    const voucher = reg.get('VOUCHER').createPayment({ uuid: id(), tendered: 5000, reference: 'V-123' }, 9000);
    const cash = reg.get('CASH').createPayment({ uuid: id(), tendered: 5000 }, 4000);
    expect(() => {
      v.validate(9000, [voucher, cash]);
    }).not.toThrow();
    expect(reg.list().map((m) => m.code)).toEqual(['CASH', 'GCASH', 'CARD', 'VOUCHER']);
  });

  it('refuses duplicate registration', () => {
    expect(() => PaymentMethodRegistry.withDefaults().register(new CashPayment())).toThrow();
  });
});
