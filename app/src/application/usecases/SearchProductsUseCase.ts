import { normalizeSearchText, type ProductWithStock } from '../../domain/entities/Product';
import type { ProductReader, ProductSearchPage } from '../../domain/repositories/ProductRepository';

export const PRODUCT_PAGE_SIZE = 60;

export class SearchProductsUseCase {
  constructor(private readonly products: ProductReader) {}

  execute(input: { term: string; category: string | null; page: number; pageSize?: number }): Promise<ProductSearchPage> {
    const limit = Math.min(Math.max(input.pageSize ?? PRODUCT_PAGE_SIZE, 1), 200);
    return this.products.search({
      term: normalizeSearchText(input.term).slice(0, 100),
      category: input.category,
      limit,
      offset: Math.max(0, input.page) * limit,
    });
  }

  /** Exact barcode / SKU lookup (hardware scanners type the code then Enter). */
  findByCode(code: string): Promise<ProductWithStock | null> {
    const c = code.trim();
    return c ? this.products.findByCode(c) : Promise.resolve(null);
  }

  categories(): Promise<readonly string[]> {
    return this.products.listCategories();
  }
}
