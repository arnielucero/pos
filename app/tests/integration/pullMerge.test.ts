import { describe, expect, it } from 'vitest';
import { SETTINGS_CATALOG_SYNCED_AT } from '../../src/application/usecases/CompleteSaleUseCase';
import { SETTINGS_PULL_SINCE } from '../../src/application/usecases/PullCatalogUseCase';
import { cashPayment, CHICKEN } from '../support/harness';
import { syncHarness } from '../support/syncHarness';

const product = (i: number) => ({
  uuid: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
  sku: `SKU-${String(i)}`,
  barcode: null,
  name: `Product ${String(i)}`,
  category: 'Misc',
  price: 1000 + i,
  is_active: true,
  track_stock: true,
  updated_at: '2026-10-02T00:00:00Z',
  deleted: false,
});

describe('PullCatalogUseCase merge', () => {
  it('keeps unsynced local deductions when server balances arrive (balance = server − pending local)', async () => {
    const h = await syncHarness();
    await h.completeSale.execute({
      lines: [{ productUuid: CHICKEN.uuid, quantity: 3, discount: null }],
      orderDiscount: null,
      payments: [cashPayment(36000, 36000)],
    });
    const bal = async () => (await h.repos.inventory.getBalances([CHICKEN.uuid])).get(CHICKEN.uuid);
    expect((await bal())?.quantityOnHand).toBe(7);

    // Server (which has NOT seen our sale) reports 20 after a delivery.
    h.server.pullPages = [{ products: [], inventory: [{ product_uuid: CHICKEN.uuid, quantity_on_hand: 20, updated_at: '2026-10-02T02:00:00Z' }], approvers: [] }];
    await h.pull.execute();
    expect((await bal())?.quantityOnHand).toBe(17);
    expect((await bal())?.serverQuantity).toBe(20);

    // Sale syncs; server now reports 17 → no double deduction.
    await h.push.execute();
    h.server.pullPages = [{ products: [], inventory: [{ product_uuid: CHICKEN.uuid, quantity_on_hand: 17, updated_at: '2026-10-02T02:05:00Z' }], approvers: [] }];
    await h.pull.execute();
    expect((await bal())?.quantityOnHand).toBe(17);
  });

  it('pages through has_more, advances the cursor with a 2-minute overlap, soft-deletes, upserts approvers', async () => {
    const h = await syncHarness();
    h.server.serverTime = '2026-10-02T03:00:00Z';
    h.server.pullPages = [
      { products: [product(1), product(2)], inventory: [], approvers: [{ user_uuid: 'm1', name: 'M', permissions: ['approval.grant'], pin_hash: '$2y$12$abc', is_active: true }] },
      { products: [{ ...product(3), deleted: true }], inventory: [], approvers: [{ user_uuid: 'm1', name: 'M', permissions: ['approval.grant'], pin_hash: '$2y$12$abc', is_active: false }] },
    ];
    const s = await h.pull.execute();
    expect(s.pages).toBe(2);
    expect(await h.repos.settings.get(SETTINGS_PULL_SINCE)).toBe('2026-10-02T02:58:00.000Z');
    expect(await h.repos.settings.get(SETTINGS_CATALOG_SYNCED_AT)).toBe('2026-10-02T03:00:00Z');
    const found = await h.repos.productReader.search({ term: 'product', category: null, limit: 10, offset: 0 });
    expect(found.items.map((p) => p.name)).toEqual(['Product 1', 'Product 2']);
    expect(await h.repos.approvers.listActive()).toHaveLength(0);
    // second pull sends since
    await h.pull.execute();
    expect(h.server.requests.at(-1)?.path).toContain('since=2026-10-02T02%3A58%3A00.000Z');
  });
});
