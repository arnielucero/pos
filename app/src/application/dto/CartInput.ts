import { z } from 'zod';
import type { Approval } from '../../domain/entities/Approval';

/** Zod schema for checkout input coming from the UI (validated before any domain logic). */
export const discountInputSchema = z
  .object({
    type: z.enum(['PERCENT', 'AMOUNT']),
    value: z.number().int().min(0),
  })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 10000, { message: 'Percent discount cannot exceed 100%' });

export const cartLineInputSchema = z.object({
  productUuid: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(9999),
  discount: discountInputSchema.nullable(),
});

export const paymentInputSchema = z.object({
  uuid: z.uuid(),
  method: z.string().min(1).max(20),
  amount: z.number().int().min(0),
  tendered: z.number().int().min(0),
  change: z.number().int().min(0),
  reference: z.string().max(100).nullable(),
});

export const checkoutInputSchema = z.object({
  lines: z.array(cartLineInputSchema).min(1, 'Cart is empty').max(500),
  orderDiscount: discountInputSchema.nullable(),
  payments: z.array(paymentInputSchema).max(10),
});

export type DiscountInput = z.infer<typeof discountInputSchema>;
export type CartLineInput = z.infer<typeof cartLineInputSchema>;

export interface CheckoutApprovals {
  /** Approval for discount.apply covering line + order discounts. */
  readonly discount?: Approval | null;
  /** Approval for sale.create (rare: user lacking sale.create). */
  readonly saleCreate?: Approval | null;
}

export type CheckoutInput = z.infer<typeof checkoutInputSchema> & { readonly approvals?: CheckoutApprovals };
