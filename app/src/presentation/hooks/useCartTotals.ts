import { useMemo } from 'react';
import type { PricingResult } from '../../domain/services/PricingCalculator';
import { useCartStore } from '../stores/cartStore';
import { useContainer } from './ContainerContext';
import { useStoreSettings } from './useStoreSettings';

/** Live cart totals computed with the same PricingCalculator used at checkout. */
export function useCartTotals(): PricingResult | null {
  const { pricing } = useContainer();
  const lines = useCartStore((s) => s.lines);
  const orderDiscount = useCartStore((s) => s.orderDiscount);
  const settings = useStoreSettings();
  return useMemo(() => {
    try {
      return pricing.calculate({
        items: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount })),
        orderDiscount,
        taxRateBp: settings.taxRateBp,
      });
    } catch {
      return null;
    }
  }, [pricing, lines, orderDiscount, settings.taxRateBp]);
}
