import { ValidationError } from '../errors/DomainError';
import type { Discount } from '../entities/Sale';

/**
 * Client-side mirror of the server's `max_discount_bp` rule (API.md step 6). Enforcing it
 * locally avoids sales arriving FLAGGED with DISCOUNT_UNAUTHORIZED.
 */
export class DiscountPolicy {
  constructor(private readonly maxDiscountBp: number) {}

  assertWithinLimit(discount: Discount | null, base: number, label: string): void {
    if (!discount) return;
    if (!Number.isSafeInteger(discount.value) || discount.value < 0) {
      throw new ValidationError(`${label}: discount must be a non-negative whole number`);
    }
    if (discount.type === 'PERCENT') {
      if (discount.value > this.maxDiscountBp) {
        throw new ValidationError(`${label}: discount exceeds the store maximum of ${String(this.maxDiscountBp / 100)}%`);
      }
      return;
    }
    // AMOUNT: value / base ≤ max/10000  ⇔  value × 10000 ≤ base × max (exact integers)
    if (discount.value * 10000 > base * this.maxDiscountBp) {
      throw new ValidationError(`${label}: discount exceeds the store maximum of ${String(this.maxDiscountBp / 100)}%`);
    }
  }
}
