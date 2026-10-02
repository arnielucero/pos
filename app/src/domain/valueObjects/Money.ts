import { ValidationError } from '../errors/DomainError';

/** Integer centavos. All money in the system is integer centavos (API.md). */
export type Centavos = number;

export function assertCentavos(value: number, field = 'amount'): asserts value is Centavos {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} must be an integer number of centavos`, { [field]: ['not an integer'] });
  }
}

/** Immutable money value object (PHP, integer centavos). */
export class Money {
  private constructor(readonly centavos: Centavos) {}

  static of(centavos: number): Money {
    assertCentavos(centavos);
    return new Money(centavos);
  }

  static zero(): Money {
    return new Money(0);
  }

  /** Parses a user-entered peso string ("120", "120.5", "1,234.50") into Money. */
  static parsePesos(input: string): Money | null {
    const cleaned = input.replace(/[,\s₱]/g, '');
    if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
    const [whole = '0', frac = ''] = cleaned.split('.');
    const centavos = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    return Number.isSafeInteger(centavos) ? new Money(centavos) : null;
  }

  add(other: Money): Money {
    return Money.of(this.centavos + other.centavos);
  }

  subtract(other: Money): Money {
    return Money.of(this.centavos - other.centavos);
  }

  isNegative(): boolean {
    return this.centavos < 0;
  }

  equals(other: Money): boolean {
    return this.centavos === other.centavos;
  }

  /** "₱1,234.50" (or "-₱5.00"). */
  format(symbol = '₱'): string {
    return formatCentavos(this.centavos, symbol);
  }
}

export function formatCentavos(centavos: number, symbol = '₱'): string {
  const negative = centavos < 0;
  const abs = Math.abs(centavos);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${symbol}${grouped}.${frac}`;
}
