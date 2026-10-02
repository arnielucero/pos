import { create } from 'zustand';
import type { Approval } from '../../domain/entities/Approval';
import type { ProductWithStock } from '../../domain/entities/Product';
import type { Discount } from '../../domain/entities/Sale';
import { Quantity } from '../../domain/valueObjects/Quantity';

export interface CartLine {
  readonly productUuid: string;
  readonly name: string;
  readonly sku: string;
  /** Display only — the sale is always priced from the local catalog at checkout. */
  readonly unitPrice: number;
  readonly trackStock: boolean;
  readonly available: number | null;
  readonly quantity: number;
  readonly discount: Discount | null;
}

interface CartState {
  readonly lines: readonly CartLine[];
  readonly orderDiscount: Discount | null;
  readonly discountApproval: Approval | null;
  add(product: ProductWithStock): void;
  setQuantity(productUuid: string, quantity: number): void;
  increment(productUuid: string, delta: number): void;
  remove(productUuid: string): void;
  setLineDiscount(productUuid: string, discount: Discount | null, approval: Approval | null): void;
  setOrderDiscount(discount: Discount | null, approval: Approval | null): void;
  clear(): void;
}

/** Small UI state for the current cart (the catalog itself is never kept in a store). */
export const useCartStore = create<CartState>((set) => ({
  lines: [],
  orderDiscount: null,
  discountApproval: null,
  add: (p) => {
    set((s) => {
      const existing = s.lines.find((l) => l.productUuid === p.uuid);
      if (existing) {
        return {
          lines: s.lines.map((l) =>
            l.productUuid === p.uuid && Quantity.isValid(l.quantity + 1) ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        };
      }
      const line: CartLine = {
        productUuid: p.uuid,
        name: p.name,
        sku: p.sku,
        unitPrice: p.price,
        trackStock: p.trackStock,
        available: p.quantityOnHand,
        quantity: 1,
        discount: null,
      };
      return { lines: [...s.lines, line] };
    });
  },
  setQuantity: (uuid, quantity) => {
    set((s) => ({
      lines: Quantity.isValid(quantity) ? s.lines.map((l) => (l.productUuid === uuid ? { ...l, quantity } : l)) : s.lines,
    }));
  },
  increment: (uuid, delta) => {
    set((s) => ({
      lines: s.lines.flatMap((l) => {
        if (l.productUuid !== uuid) return [l];
        const q = l.quantity + delta;
        if (q <= 0) return [];
        return Quantity.isValid(q) ? [{ ...l, quantity: q }] : [l];
      }),
    }));
  },
  remove: (uuid) => {
    set((s) => ({ lines: s.lines.filter((l) => l.productUuid !== uuid) }));
  },
  setLineDiscount: (uuid, discount, approval) => {
    set((s) => ({
      lines: s.lines.map((l) => (l.productUuid === uuid ? { ...l, discount } : l)),
      discountApproval: approval ?? s.discountApproval,
    }));
  },
  setOrderDiscount: (discount, approval) => {
    set((s) => ({ orderDiscount: discount, discountApproval: approval ?? s.discountApproval }));
  },
  clear: () => {
    set({ lines: [], orderDiscount: null, discountApproval: null });
  },
}));
