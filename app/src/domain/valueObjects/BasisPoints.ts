import { ValidationError } from '../errors/DomainError';

/** Percentages are basis points: 12.5% → 1250. */
export type BasisPoints = number;

export function assertBasisPoints(value: number, field = 'value'): BasisPoints {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new ValidationError(`${field} must be between 0 and 10000 basis points`, { [field]: ['out of range'] });
  }
  return value;
}

/** "12.5%" display for basis points. */
export function formatBasisPoints(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '')}%`;
}
