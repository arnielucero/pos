import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/domain/entities/Product';
import { SearchProductsUseCase } from '../../src/application/usecases/SearchProductsUseCase';
import { createSqliteRepositories, SqliteUnitOfWork } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { openTestDb } from '../support/harness';

describe('Product search (50k products)', () => {
  it('finds by barcode, sku prefix and name, paginated, fast enough', async () => {
    const db = await openTestDb();
    const uow = new SqliteUnitOfWork(db);
    const products: Product[] = Array.from({ length: 50_000 }, (_, i) => ({
      uuid: `p-${String(i)}`,
      sku: `SKU-${String(i).padStart(6, '0')}`,
      barcode: `480${String(i).padStart(10, '0')}`,
      name: i === 4242 ? 'Café Latte Grande' : `Item ${String(i)} ${i % 2 ? 'Rice' : 'Noodles'}`,
      category: i % 3 ? 'Food' : 'Drinks',
      price: 1000 + i,
      isActive: i !== 7,
      trackStock: true,
      updatedAt: '2026-10-02T00:00:00Z',
      deleted: false,
    }));
    for (let i = 0; i < products.length; i += 5000) await uow.run((r) => r.productWriter.upsertMany(products.slice(i, i + 5000)));
    const search = new SearchProductsUseCase(createSqliteRepositories(db).productReader);

    const t0 = performance.now();
    const byName = await search.execute({ term: 'cafe latte', category: null, page: 0 });
    const byBarcode = await search.execute({ term: '4800000004242', category: null, page: 0 });
    const bySku = await search.execute({ term: 'sku-00424', category: null, page: 0, pageSize: 20 });
    const page2 = await search.execute({ term: 'rice', category: 'Food', page: 1, pageSize: 50 });
    const elapsed = performance.now() - t0;

    expect(byName.items[0]?.name).toBe('Café Latte Grande');
    expect(byBarcode.items[0]?.uuid).toBe('p-4242');
    expect(bySku.items.map((p) => p.sku).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `SKU-00424${String(i)}`));
    expect(bySku.hasMore).toBe(false);
    expect(page2.items).toHaveLength(50);
    expect(page2.hasMore).toBe(true);
    expect((await search.findByCode('SKU-000007'))).toBeNull(); // inactive
    expect((await search.findByCode('4800000000008'))?.uuid).toBe('p-8');
    expect(elapsed).toBeLessThan(2000);
  }, 60_000);
});
