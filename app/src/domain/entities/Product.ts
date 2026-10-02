export interface Product {
  readonly uuid: string;
  readonly sku: string;
  readonly barcode: string | null;
  readonly name: string;
  readonly category: string | null;
  /** VAT-inclusive unit price in centavos. */
  readonly price: number;
  readonly isActive: boolean;
  readonly trackStock: boolean;
  readonly updatedAt: string;
  readonly deleted: boolean;
}

export interface ProductWithStock extends Product {
  /** null when the product has no inventory row yet. */
  readonly quantityOnHand: number | null;
}

/** Lower-cased, accent-stripped, whitespace-collapsed form used for indexed search. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
