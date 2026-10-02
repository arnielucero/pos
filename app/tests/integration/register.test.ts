import { describe, expect, it } from 'vitest';
import { CloseRegisterUseCase } from '../../src/application/usecases/CloseRegisterUseCase';
import { PermissionDeniedError } from '../../src/domain/errors/DomainError';
import { SqliteUnitOfWork } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { cashPayment, CHICKEN, MANAGER, saleHarness, silentLogger } from '../support/harness';

describe('Register X/Z reports', () => {
  it('computes expected cash excluding voided sales and queues CLOSE_REGISTER', async () => {
    const h = await saleHarness();
    const close = new CloseRegisterUseCase({ uow: new SqliteUnitOfWork(h.db), session: h.session, clock: h.clock, logger: silentLogger, sync: h.trigger });
    const line = (q: number) => [{ productUuid: CHICKEN.uuid, quantity: q, discount: null }];
    await h.completeSale.execute({ lines: line(1), orderDiscount: null, payments: [cashPayment(12000, 20000)] });
    const card = await h.completeSale.execute({
      lines: line(2),
      orderDiscount: null,
      payments: [cashPayment(4000, 4000), { uuid: globalThis.crypto.randomUUID(), method: 'CARD', amount: 20000, tendered: 20000, change: 0, reference: 'A1' }],
    });
    const voided = await h.completeSale.execute({ lines: line(1), orderDiscount: null, payments: [cashPayment(12000, 12000)] });
    h.session.update({ user: MANAGER });
    await h.voidSale.execute({ saleUuid: voided.sale.uuid, reason: 'mistake' });

    const x = await close.xReport();
    expect(x).toMatchObject({ kind: 'X', openingCash: 200000, cashSales: 16000, cashRefunds: 0, expectedCash: 216000, salesCount: 2, voidCount: 1 });
    expect(x.paymentsByMethod).toEqual({ CASH: 16000, CARD: 20000 });
    expect(card.sale.total).toBe(24000);

    h.session.update({ user: { ...MANAGER, permissions: ['sale.create'] } });
    await expect(close.close({ actualCash: 215800 })).rejects.toBeInstanceOf(PermissionDeniedError);
    h.session.update({ user: MANAGER });
    const z = await close.close({ actualCash: 215800 });
    expect(z).toMatchObject({ kind: 'Z', expectedCash: 216000, actualCash: 215800, variance: -200 });
    expect(h.session.getState().registerSession).toBeNull();
    const row = await h.db.query(`SELECT uuid, payload FROM sync_queue WHERE operation = 'CLOSE_REGISTER'`);
    const payload = JSON.parse(String(row[0]?.['payload'])) as Record<string, number | string>;
    expect(payload['uuid']).toBe(row[0]?.['uuid']);
    expect(payload['variance']).toBe(Number(payload['actual_cash']) - Number(payload['expected_cash']));
  });
});
