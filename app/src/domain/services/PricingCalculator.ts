import { ValidationError } from '../errors/DomainError';
import type { Discount } from '../entities/Sale';

/**
 * Pricing algorithm from docs/API.md#pricing-algorithm. Must stay byte-for-byte equivalent
 * to backend/app/Domain/Pricing/PricingCalculator.php — both are tested against
 * docs/pricing-vectors.json.
 *
 * All arithmetic is exact integer arithmetic (no floats): half-up division is done with
 * integer floor on doubled numerators, and every intermediate is checked to stay within
 * Number.MAX_SAFE_INTEGER.
 */
export interface PricingLineInput {
  readonly unitPrice: number;
  readonly quantity: number;
  readonly discount: Discount | null;
}

export interface PricingInput {
  readonly items: readonly PricingLineInput[];
  readonly orderDiscount: Discount | null;
  readonly taxRateBp: number;
}

export interface PricedLine {
  readonly lineGross: number;
  readonly lineDiscount: number;
  readonly lineTotal: number;
}

export interface PricingResult {
  readonly lines: readonly PricedLine[];
  readonly subtotal: number;
  readonly linesNet: number;
  readonly orderDiscount: number;
  readonly discountTotal: number;
  readonly total: number;
  readonly taxTotal: number;
}

function safe(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new ValidationError(`${what} is out of range`);
  return n;
}

/** roundHalfUp(numerator / denominator) for non-negative integers, exact. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (numerator < 0 || denominator <= 0) throw new ValidationError('Invalid rounding operands');
  safe(numerator * 2, 'amount');
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

function applyDiscount(base: number, discount: Discount | null): number {
  if (!discount) return 0;
  let amount: number;
  if (discount.type === 'PERCENT') {
    if (!Number.isSafeInteger(discount.value) || discount.value < 0 || discount.value > 10000) {
      throw new ValidationError('Percent discount must be between 0 and 10000 basis points');
    }
    amount = divRoundHalfUp(safe(base * discount.value, 'discount'), 10000);
  } else {
    if (!Number.isSafeInteger(discount.value) || discount.value < 0) {
      throw new ValidationError('Amount discount must be a non-negative integer');
    }
    amount = discount.value;
  }
  return Math.min(amount, base);
}

export class PricingCalculator {
  calculate(input: PricingInput): PricingResult {
    if (!Number.isSafeInteger(input.taxRateBp) || input.taxRateBp < 0) {
      throw new ValidationError('tax_rate_bp must be a non-negative integer');
    }
    const lines = input.items.map((item): PricedLine => {
      if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0) {
        throw new ValidationError('unit_price must be a non-negative integer');
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new ValidationError('quantity must be a positive integer');
      }
      const lineGross = safe(item.unitPrice * item.quantity, 'line_gross');
      const lineDiscount = applyDiscount(lineGross, item.discount);
      return { lineGross, lineDiscount, lineTotal: lineGross - lineDiscount };
    });
    const subtotal = safe(
      lines.reduce((s, l) => s + l.lineGross, 0),
      'subtotal',
    );
    const linesNet = lines.reduce((s, l) => s + l.lineTotal, 0);
    const orderDiscount = applyDiscount(linesNet, input.orderDiscount);
    const discountTotal = lines.reduce((s, l) => s + l.lineDiscount, 0) + orderDiscount;
    const total = linesNet - orderDiscount;
    const taxTotal = divRoundHalfUp(safe(total * input.taxRateBp, 'tax'), 10000 + input.taxRateBp);
    return { lines, subtotal, linesNet, orderDiscount, discountTotal, total, taxTotal };
  }
}
