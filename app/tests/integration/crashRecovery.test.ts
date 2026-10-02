import { describe, expect, it } from 'vitest';
import { createSqliteRepositories } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { cashPayment, CHICKEN, openTestDb, saleHarness } from '../support/harness';

describe('Crash recovery', () => {
  it('a sale committed before a crash survives; IN_FLIGHT ops become PENDING after restart', async () => {
    const h = await saleHarness();
    const { sale } = await h.completeSale.execute({
      lines: [{ productUuid: CHICKEN.uuid, quantity: 1, discount: null }],
      orderDiscount: null,
      payments: [cashPayment(12000, 12000)],
    });
    const claimed = await h.uow.run((r) => r.syncQueue.claimDue(h.clock.now(), 50));
    expect(claimed.map((c) => c.uuid)).toContain(sale.uuid);

    // "Crash": take the on-disk image as it is right now and reopen it in a new process.
    const restarted = await openTestDb(h.db.exportBytes());
    const repos = createSqliteRepositories(restarted);
    expect((await repos.syncQueue.findByUuid(sale.uuid))?.status).toBe('IN_FLIGHT');
    expect(await repos.syncQueue.resetInFlight()).toBe(claimed.length);
    expect(await repos.syncQueue.findByUuid(sale.uuid)).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await repos.saleReader.findByUuid(sale.uuid))?.total).toBe(12000);
    expect((await repos.inventory.getBalances([CHICKEN.uuid])).get(CHICKEN.uuid)?.quantityOnHand).toBe(9);
  });
});
