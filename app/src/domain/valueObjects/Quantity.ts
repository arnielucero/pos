import { ValidationError } from '../errors/DomainError';

/** Positive integer quantity of units (weighted items are out of scope for v1). */
export class Quantity {
  static readonly MAX = 9999;

  private constructor(readonly value: number) {}

  static of(value: number): Quantity {
    if (!Number.isSafeInteger(value) || value <= 0 || value > Quantity.MAX) {
      throw new ValidationError(`Quantity must be a whole number between 1 and ${String(Quantity.MAX)}`, {
        quantity: ['invalid'],
      });
    }
    return new Quantity(value);
  }

  static isValid(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0 && value <= Quantity.MAX;
  }
}
