import { describe, expect, it } from 'vitest';
import type { TransactionalRepositories } from '../../src/domain/repositories/UnitOfWork';
import {
  InsufficientStockError,
  PaymentFailedError,
  PermissionDeniedError,
  PrinterConnectionError,
  RegisterNotOpenError,
  ValidationError,
} from '../../src/domain/errors/DomainError';
import type { SqlExecutor } from '../../src/infrastructure/database/SqlDatabase';
import { createSqliteRepositories } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { cashPayment, CHICKEN, COFFEE, count, MANAGER, saleHarness } from '../support/harness';

const twoChicken = { lines: [{ productUuid: CHICKEN.uuid, quantity: 2, discount: null }], orderDiscount: null };

async function stockOf(h: Awaited<ReturnType<typeof saleHarness>>, uuid = CHICKEN.uuid): Promise<number | undefined> {
  return (await h.repos.inventory.getBalances([uuid])).get(uuid)?.quantityOnHand;
}

describe('CompleteSaleUseCase (sql.js integration)', () => {
  it('persists sale, items, payments, movements, queue row and audit atomically', async () => {
    const h = await saleHarness();
    const res = await h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 50000)] });
    expect(res.sale.total).toBe(24000);
    expect(res.sale.receiptNumber).toMatch(/^POS-01-\d{8}-00001$/);
    expect(res.print?.ok).toBe(true);
    expect(res.sale.printStatus).toBe('PRINTED');
    expect(h.printer.printed[0]).toContain('Chicken Rice');

    const saved = await h.repos.saleReader.findByUuid(res.sale.uuid);
    expect(saved?.items).toHaveLength(1);
    expect(saved?.payments[0]).toMatchObject({ method: 'CASH', amount: 24000, tendered: 50000, change: 26000 });
    expect(await stockOf(h)).toBe(8);

    const queued = await h.repos.syncQueue.findByUuid(res.sale.uuid);
    expect(queued).toMatchObject({ operation: 'CREATE_SALE', status: 'PENDING', entityId: res.sale.uuid });
    const payload = queued?.payload as Record<string, unknown>;
    expect(payload['uuid']).toBe(res.sale.uuid);
    expect(payload['total']).toBe(24000);
    expect(payload['tax_total']).toBe(2571);
    expect(await count(h.db, 'audit_logs', "action = 'SALE_CREATED'")).toBe(1);
    expect(h.trigger.reasons).toContain('sale-completed');

    const second = await h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] });
    expect(second.sale.receiptNumber.endsWith('-00002')).toBe(true);
  });

  it('prices from the local catalog, never from the client', async () => {
    const h = await saleHarness();
    const res = await h.completeSale.execute({
      lines: [{ productUuid: COFFEE.uuid, quantity: 1, discount: null }],
      orderDiscount: null,
      payments: [cashPayment(9000, 10000)],
    });
    expect(res.sale.items[0]?.unitPrice).toBe(9000);
    // Coffee does not track stock → no movement
    expect(await count(h.db, 'inventory_movements', `product_uuid = '${COFFEE.uuid}'`)).toBe(0);
  });

  it('is atomic: a failure mid-transaction persists nothing and leaves stock unchanged', async () => {
    const failing = (ex: SqlExecutor): TransactionalRepositories => {
      const repos = createSqliteRepositories(ex);
      return {
        ...repos,
        audit: { ...repos.audit, append: () => Promise.reject(new Error('disk full')) },
      };
    };
    const h = await saleHarness({ factory: failing });
    await expect(h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] })).rejects.toThrow('disk full');
    expect(await count(h.db, 'sales')).toBe(0);
    expect(await count(h.db, 'sale_items')).toBe(0);
    expect(await count(h.db, 'payments')).toBe(0);
    expect(await count(h.db, 'inventory_movements')).toBe(0);
    expect(await count(h.db, 'sync_queue', "operation = 'CREATE_SALE'")).toBe(0);
    expect(await count(h.db, 'receipt_counters')).toBe(0);
    expect(await stockOf(h)).toBe(10);
    expect(h.printer.printed).toHaveLength(0);
  });

  it('blocks when stock is insufficient (default policy)', async () => {
    const h = await saleHarness({ stock: 1 });
    await expect(h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] })).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect(await count(h.db, 'sales')).toBe(0);
    expect(await stockOf(h)).toBe(1);
  });

  it('warns but sells when stock policy is WARN', async () => {
    const h = await saleHarness({ stock: 1 });
    await h.repos.settings.saveStoreSettings({ stockPolicy: 'WARN' });
    const res = await h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] });
    expect(res.stockWarnings).toHaveLength(1);
    expect(await stockOf(h)).toBe(-1);
  });

  it('rejects bad payments and empty carts without writing anything', async () => {
    const h = await saleHarness();
    await expect(h.completeSale.execute({ ...twoChicken, payments: [cashPayment(20000, 20000)] })).rejects.toBeInstanceOf(PaymentFailedError);
    await expect(h.completeSale.execute({ lines: [], orderDiscount: null, payments: [] })).rejects.toBeInstanceOf(ValidationError);
    expect(await count(h.db, 'sales')).toBe(0);
  });

  it('requires discount.apply or an approval for discounts, and enforces max_discount_bp', async () => {
    const h = await saleHarness();
    const discounted = {
      lines: [{ productUuid: CHICKEN.uuid, quantity: 2, discount: { type: 'PERCENT' as const, value: 1000 } }],
      orderDiscount: { type: 'AMOUNT' as const, value: 1000 },
      payments: [cashPayment(20600, 20600)],
    };
    await expect(h.completeSale.execute(discounted)).rejects.toBeInstanceOf(PermissionDeniedError);
    const approval = { approvedByUuid: MANAGER.uuid, approvedByName: MANAGER.name, approvedAt: '2026-10-02T01:00:00Z', mode: 'OFFLINE_PIN' as const, reason: 'promo', permission: 'discount.apply' };
    const res = await h.completeSale.execute({ ...discounted, approvals: { discount: approval } });
    expect(res.sale.total).toBe(20600);
    expect(res.sale.taxTotal).toBe(2207);
    const payload = (await h.repos.syncQueue.findByUuid(res.sale.uuid))?.payload as { items: { discount: { approval: { mode: string } } }[]; order_discount: { approval: { approved_by_uuid: string } } };
    expect(payload.items[0]?.discount.approval.mode).toBe('OFFLINE_PIN');
    expect(payload.order_discount.approval.approved_by_uuid).toBe(MANAGER.uuid);

    h.session.update({ user: MANAGER });
    await expect(
      h.completeSale.execute({
        lines: [{ productUuid: CHICKEN.uuid, quantity: 1, discount: { type: 'PERCENT', value: 6000 } }],
        orderDiscount: null,
        payments: [cashPayment(4800, 4800)],
      }),
    ).rejects.toThrow(/maximum/);
  });

  it('requires an open register', async () => {
    const h = await saleHarness();
    h.session.update({ registerSession: null });
    await expect(h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] })).rejects.toBeInstanceOf(RegisterNotOpenError);
  });

  it('a printer failure never fails the sale (print_status = FAILED)', async () => {
    const h = await saleHarness();
    h.printer.failNext = new PrinterConnectionError('PAPER_OUT', 'out of paper');
    const res = await h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] });
    expect(res.print?.ok).toBe(false);
    expect(res.sale.printStatus).toBe('FAILED');
    expect((await h.repos.saleReader.findByUuid(res.sale.uuid))?.printStatus).toBe('FAILED');
    expect(await count(h.db, 'audit_logs', "action = 'PRINT_FAILED'")).toBe(1);
    // Reprint later works and does not create a sale
    const again = await h.print.execute(res.sale.uuid, { reprint: true });
    expect(again.ok).toBe(true);
    expect(await count(h.db, 'sales')).toBe(1);
    expect(h.printer.printed.at(-1)).toContain('REPRINT');
  });

  it('void reverses stock, keeps money columns, queues VOID_SALE with key = void uuid', async () => {
    const h = await saleHarness();
    const res = await h.completeSale.execute({ ...twoChicken, payments: [cashPayment(24000, 24000)] });
    expect(await stockOf(h)).toBe(8);
    await expect(h.voidSale.execute({ saleUuid: res.sale.uuid, reason: 'Customer changed mind' })).rejects.toBeInstanceOf(PermissionDeniedError);
    h.session.update({ user: MANAGER });
    await h.voidSale.execute({ saleUuid: res.sale.uuid, reason: 'Customer changed mind' });
    expect(await stockOf(h)).toBe(10);
    const sale = await h.repos.saleReader.findByUuid(res.sale.uuid);
    expect(sale).toMatchObject({ status: 'VOIDED', total: 24000, voidReason: 'Customer changed mind' });
    const voids = await h.db.query(`SELECT uuid, payload FROM sync_queue WHERE operation = 'VOID_SALE'`);
    expect(voids).toHaveLength(1);
    const payload = JSON.parse(String(voids[0]?.['payload'])) as Record<string, unknown>;
    expect(payload['uuid']).toBe(voids[0]?.['uuid']);
    expect(payload['sale_uuid']).toBe(res.sale.uuid);
    await expect(h.voidSale.execute({ saleUuid: res.sale.uuid, reason: 'again' })).rejects.toThrow(/already voided/);
  });
});
