import type { Product, ProductWithStock } from '../entities/Product';

export interface ProductSearchQuery {
  readonly term: string;
  readonly category: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly includeInactive?: boolean;
}

export interface ProductSearchPage {
  readonly items: readonly ProductWithStock[];
  readonly hasMore: boolean;
}

export interface ProductReader {
  findByUuids(uuids: readonly string[]): Promise<readonly ProductWithStock[]>;
  findByCode(code: string): Promise<ProductWithStock | null>;
  search(query: ProductSearchQuery): Promise<ProductSearchPage>;
  listCategories(): Promise<readonly string[]>;
  countActive(): Promise<number>;
}

export interface ProductWriter {
  upsertMany(products: readonly Product[]): Promise<void>;
}
