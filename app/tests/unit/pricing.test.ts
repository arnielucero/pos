import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DiscountPolicy } from '../../src/domain/services/DiscountPolicy';
import { divRoundHalfUp, PricingCalculator } from '../../src/domain/services/PricingCalculator';
import { ValidationError } from '../../src/domain/errors/DomainError';

const discount = z.object({ type: z.enum(['PERCENT', 'AMOUNT']), value: z.number().int() }).nullable();
const vectorsSchema = z.object({
  vectors: z.array(
    z.object({
      name: z.string(),
      tax_rate_bp: z.number().int(),
      items: z.array(z.object({ unit_price: z.number().int(), quantity: z.number().int(), discount })),
      order_discount: discount,
      expected: z.object({
        lines: z.array(z.object({ line_gross: z.number(), line_discount: z.number(), line_total: z.number() })),
        subtotal: z.number(),
        order_discount: z.number(),
        discount_total: z.number(),
        total: z.number(),
        tax_total: z.number(),
      }),
    }),
  ),
});

const vectorsPath = fileURLToPath(new URL('../../../docs/pricing-vectors.json', import.meta.url));
const { vectors } = vectorsSchema.parse(JSON.parse(readFileSync(vectorsPath, 'utf8')));
const calc = new PricingCalculator();

describe('PricingCalculator — shared vectors (docs/pricing-vectors.json)', () => {
  it('loads a non-trivial number of vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
  });

  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const r = calc.calculate({
      items: v.items.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity, discount: i.discount })),
      orderDiscount: v.order_discount,
      taxRateBp: v.tax_rate_bp,
    });
    expect(r.lines.map((l) => ({ line_gross: l.lineGross, line_discount: l.lineDiscount, line_total: l.lineTotal }))).toEqual(
      v.expected.lines,
    );
    expect(r.subtotal).toBe(v.expected.subtotal);
    expect(r.orderDiscount).toBe(v.expected.order_discount);
    expect(r.discountTotal).toBe(v.expected.discount_total);
    expect(r.total).toBe(v.expected.total);
    expect(r.taxTotal).toBe(v.expected.tax_total);
  });
});

describe('PricingCalculator — rules', () => {
  it('rounds half up exactly with integers', () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(25000, 10000)).toBe(3);
  });

  it('computes VAT-inclusive tax at 12%', () => {
    const r = calc.calculate({ items: [{ unitPrice: 11200, quantity: 1, discount: null }], orderDiscount: null, taxRateBp: 1200 });
    expect(r.taxTotal).toBe(1200);
    expect(r.total).toBe(11200);
  });

  it('applies percent line discounts then order discounts on the net', () => {
    const r = calc.calculate({
      items: [
        { unitPrice: 10000, quantity: 2, discount: { type: 'PERCENT', value: 1000 } },
        { unitPrice: 5000, quantity: 1, discount: { type: 'AMOUNT', value: 500 } },
      ],
      orderDiscount: { type: 'PERCENT', value: 1000 },
      taxRateBp: 1200,
    });
    expect(r.lines.map((l) => l.lineTotal)).toEqual([18000, 4500]);
    expect(r.linesNet).toBe(22500);
    expect(r.orderDiscount).toBe(2250);
    expect(r.discountTotal).toBe(2000 + 500 + 2250);
    expect(r.total).toBe(20250);
  });

  it('caps amount discounts at the base', () => {
    const r = calc.calculate({ items: [{ unitPrice: 100, quantity: 1, discount: { type: 'AMOUNT', value: 500 } }], orderDiscount: null, taxRateBp: 0 });
    expect(r.lines[0]?.lineDiscount).toBe(100);
    expect(r.total).toBe(0);
  });

  it('rejects invalid inputs', () => {
    expect(() => calc.calculate({ items: [{ unitPrice: 1.5, quantity: 1, discount: null }], orderDiscount: null, taxRateBp: 0 })).toThrow(
      ValidationError,
    );
    expect(() => calc.calculate({ items: [{ unitPrice: 100, quantity: 0, discount: null }], orderDiscount: null, taxRateBp: 0 })).toThrow(
      ValidationError,
    );
    expect(() =>
      calc.calculate({ items: [{ unitPrice: 100, quantity: 1, discount: { type: 'PERCENT', value: 10001 } }], orderDiscount: null, taxRateBp: 0 }),
    ).toThrow(ValidationError);
  });
});

describe('DiscountPolicy (max_discount_bp)', () => {
  const policy = new DiscountPolicy(5000);
  it('allows discounts within the cap', () => {
    expect(() => policy.assertWithinLimit({ type: 'PERCENT', value: 5000 }, 10000, 'x')).not.toThrow();
    expect(() => policy.assertWithinLimit({ type: 'AMOUNT', value: 5000 }, 10000, 'x')).not.toThrow();
  });
  it('rejects discounts above the cap', () => {
    expect(() => policy.assertWithinLimit({ type: 'PERCENT', value: 5001 }, 10000, 'x')).toThrow(ValidationError);
    expect(() => policy.assertWithinLimit({ type: 'AMOUNT', value: 5001 }, 10000, 'x')).toThrow(ValidationError);
  });
});
