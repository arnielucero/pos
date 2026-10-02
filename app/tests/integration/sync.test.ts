import { describe, expect, it } from 'vitest';
import { cashPayment, CHICKEN, count } from '../support/harness';
import { syncHarness } from '../support/syncHarness';

async function sell(h: Awaited<ReturnType<typeof syncHarness>>, qty = 1) {
  const res = await h.completeSale.execute({
    lines: [{ productUuid: CHICKEN.uuid, quantity: qty, discount: null }],
    orderDiscount: null,
    payments: [cashPayment(12000 * qty, 12000 * qty)],
  });
  return res.sale;
}

async function queueRow(h: Awaited<ReturnType<typeof syncHarness>>, uuid: string) {
  return h.repos.syncQueue.findByUuid(uuid);
}

describe('PushSyncQueueUseCase + HttpClient against a fake API', () => {
  it('APPLIED → DONE, sale SYNCED with server_id, movements synced; headers carry token + device id', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    const summary = await h.push.execute();
    expect(summary.status).toBe('OK');
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'DONE' });
    const saved = await h.repos.saleReader.findByUuid(sale.uuid);
    expect(saved?.syncStatus).toBe('SYNCED');
    expect(saved?.serverId).toBeGreaterThan(0);
    expect(await count(h.db, 'inventory_movements', "sync_status = 'PENDING' AND type = 'SALE'")).toBe(0);
    const call = h.server.syncCalls()[0];
    expect(call?.headers['Authorization']).toBe('Bearer access-1');
    expect(call?.headers['X-Device-Id']).toBe('33333333-3333-4333-8333-333333333333');
    // every op key equals payload.uuid (backend rule), except audit batches
    const ops = (call?.body as { operations: { idempotency_key: string; type: string; payload: { uuid?: string } }[] }).operations;
    for (const op of ops.filter((o) => o.type !== 'AUDIT_EVENTS')) expect(op.idempotency_key).toBe(op.payload.uuid);
    expect(ops.map((o) => o.type)).toEqual(['OPEN_REGISTER', 'CREATE_SALE', 'AUDIT_EVENTS']);
    expect(await count(h.db, 'audit_logs', 'uploaded = 0')).toBe(0);
  });

  it('server down → items back to PENDING with 5s backoff; same key and identical payload on re-push (idempotency)', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    h.server.down = true;
    const s1 = await h.push.execute();
    expect(s1.status).toBe('OFFLINE');
    const row = await queueRow(h, sale.uuid);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'NETWORK_ERROR' });
    expect(Date.parse(row?.nextRetryAt ?? '') - h.clock.now().getTime()).toBe(5000);

    // not due yet → nothing sent
    h.server.down = false;
    const before = h.server.syncCalls().length;
    expect((await h.push.execute()).status).toBe('NOTHING_TO_DO');
    expect(h.server.syncCalls().length).toBe(before);

    h.clock.advance(5000);
    expect((await h.push.execute()).status).toBe('OK');
    const sent = h.server.requests
      .filter((r) => r.path === '/sync')
      .flatMap((r) => (r.body as { operations: { idempotency_key: string; payload: unknown }[] }).operations)
      .filter((o) => o.idempotency_key === sale.uuid);
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[0]?.payload)).toBe(JSON.stringify(sent[1]?.payload));
  });

  it('backs off 5,15,30,60,300… and marks FAILED after 8 attempts (never deleted)', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    h.server.status500 = true;
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await h.push.execute();
      const row = await queueRow(h, sale.uuid);
      if (row?.status === 'PENDING') {
        const d = Date.parse(row.nextRetryAt ?? '') - h.clock.now().getTime();
        delays.push(d);
        h.clock.advance(d);
      }
    }
    expect(delays).toEqual([5000, 15000, 30000, 60000, 300000, 300000, 300000]);
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'FAILED', attempts: 8 });
    expect((await h.repos.saleReader.findByUuid(sale.uuid))?.syncStatus).toBe('FAILED');
    // Manager can requeue: same key
    const row = await queueRow(h, sale.uuid);
    await h.repos.syncQueue.requeueFailed(row?.id ?? -1);
    h.server.status500 = false;
    await h.push.execute();
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'DONE' });
    expect((await h.repos.saleReader.findByUuid(sale.uuid))?.syncStatus).toBe('SYNCED');
  });

  it('partial batch: ops without a result are retried, others complete', async () => {
    const h = await syncHarness();
    const a = await sell(h);
    const b = await sell(h);
    const original = h.server.resultFor;
    h.server.resultFor = (op) => (op.idempotency_key === b.uuid ? null : original(op));
    await h.push.execute();
    expect(await queueRow(h, a.uuid)).toMatchObject({ status: 'DONE' });
    expect(await queueRow(h, b.uuid)).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'MISSING_RESULT' });
    h.server.resultFor = original;
    h.clock.advance(5000);
    await h.push.execute();
    expect(await queueRow(h, b.uuid)).toMatchObject({ status: 'DONE' });
  });

  it('FLAGGED → sale FLAGGED + sync_conflicts rows; DUPLICATE of a flagged op stays FLAGGED', async () => {
    const h = await syncHarness();
    const a = await sell(h);
    const b = await sell(h);
    h.server.resultFor = (op) => {
      if (op.type !== 'CREATE_SALE') return { idempotency_key: op.idempotency_key, status: 'APPLIED', retryable: false };
      if (op.idempotency_key === a.uuid) {
        return {
          idempotency_key: op.idempotency_key,
          status: 'FLAGGED',
          http_status: 201,
          entity_uuid: a.uuid,
          server_id: 7,
          conflicts: [
            { type: 'PRICE_MISMATCH', entity_type: 'sale_item', entity_uuid: 'i1', local_value: 12000, server_value: 13000, message: 'price changed' },
            { type: 'TAX_MISMATCH', entity_type: 'sale', entity_uuid: a.uuid, local_value: 1286, server_value: 1300, message: 'tax' },
          ],
          error: null,
          retryable: false,
        };
      }
      return { idempotency_key: op.idempotency_key, status: 'DUPLICATE', original_status: 'FLAGGED', server_id: 8, retryable: false };
    };
    const summary = await h.push.execute();
    expect(summary.flagged).toBe(2);
    expect((await h.repos.saleReader.findByUuid(a.uuid))?.syncStatus).toBe('FLAGGED');
    expect((await h.repos.saleReader.findByUuid(b.uuid))?.syncStatus).toBe('FLAGGED');
    const conflicts = await h.repos.conflicts.list(10);
    expect(conflicts.map((c) => c.conflictType).sort()).toEqual(['FLAGGED', 'PRICE_MISMATCH', 'TAX_MISMATCH']);
    expect((await h.repos.syncQueue.counts()).flaggedSales).toBe(2);
  });

  it('REJECTED non-retryable → FAILED (kept); REJECTED retryable → backoff', async () => {
    const h = await syncHarness();
    const a = await sell(h);
    const b = await sell(h);
    h.server.resultFor = (op) => {
      if (op.idempotency_key === a.uuid) return { idempotency_key: op.idempotency_key, status: 'REJECTED', error: { code: 'INVALID_TOTALS', message: 'bad' }, retryable: false };
      if (op.idempotency_key === b.uuid) return { idempotency_key: op.idempotency_key, status: 'REJECTED', error: { code: 'CONFLICT', message: 'race' }, retryable: true };
      return { idempotency_key: op.idempotency_key, status: 'APPLIED', retryable: false };
    };
    const s = await h.push.execute();
    expect(s.rejected).toBe(2);
    expect(await queueRow(h, a.uuid)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_TOTALS' });
    expect((await h.repos.saleReader.findByUuid(a.uuid))?.syncStatus).toBe('FAILED');
    expect(await queueRow(h, b.uuid)).toMatchObject({ status: 'PENDING', attempts: 1, errorCode: 'CONFLICT' });
    expect((await h.repos.syncQueue.counts()).failed).toBe(1);
    expect(await count(h.db, 'sales')).toBe(2);
  });

  it('401 TOKEN_EXPIRED → refresh (rotated tokens stored) → retry succeeds', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    h.server.expireAccessToken = true;
    const s = await h.push.execute();
    expect(s.status).toBe('OK');
    expect(h.server.refreshCount).toBe(1);
    expect((await h.tokens.get())?.accessToken).toBe('access-2');
    expect((await h.tokens.get())?.refreshToken).toBe('refresh-2');
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'DONE', attempts: 0 });
  });

  it('refresh rejected → push paused, re-login required, queue kept intact (no attempt consumed)', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    h.server.expireAccessToken = true;
    h.server.refreshFails = true;
    const s = await h.push.execute();
    expect(s.status).toBe('AUTH_REQUIRED');
    expect(h.session.getState().reauthRequired).toBe(true);
    expect(await h.tokens.get()).toBeNull();
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'PENDING', attempts: 0 });
    // engine does not hammer the server while auth is required
    const calls = h.server.requests.length;
    await h.engine.syncNow('manual');
    expect(h.engine.getState().phase).toBe('AUTH_REQUIRED');
    expect(h.server.requests.length).toBe(calls);
  });
});

describe('SyncEngine', () => {
  it('crash recovery: IN_FLIGHT items are reset to PENDING on start and then synced', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    await h.uow.run((r) => r.syncQueue.claimDue(h.clock.now(), 50)); // simulate crash mid-push
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'IN_FLIGHT' });
    await h.engine.start();
    await h.engine.syncNow('test');
    await h.engine.stop();
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'DONE' });
    expect(h.engine.getState().lastSyncAt).not.toBeNull();
  });

  it('single-flight: concurrent triggers share one run (no double send)', async () => {
    const h = await syncHarness();
    await sell(h);
    await Promise.all([h.engine.syncNow('a'), h.engine.syncNow('b'), h.engine.syncNow('c')]);
    const creates = h.server
      .syncCalls()
      .flatMap((r) => (r.body as { operations: { type: string }[] }).operations)
      .filter((o) => o.type === 'CREATE_SALE');
    expect(creates).toHaveLength(1);
  });

  it('does nothing while offline and reports OFFLINE', async () => {
    const h = await syncHarness();
    await sell(h);
    h.network.state = 'OFFLINE';
    await h.engine.syncNow('test');
    expect(h.engine.getState().phase).toBe('OFFLINE');
    expect(h.server.syncCalls()).toHaveLength(0);
    expect(h.engine.getState().counts.pending).toBeGreaterThan(0);
  });

  it('interruption: stop() aborts and releases claimed items without consuming attempts', async () => {
    const h = await syncHarness();
    const sale = await sell(h);
    const realFetch = h.server.fetch;
    h.server.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        void realFetch;
      });
    // rebuild client using the hanging fetch
    const { HttpClient } = await import('../../src/infrastructure/api/HttpClient');
    const { HttpApiGateway } = await import('../../src/infrastructure/api/HttpApiGateway');
    const { PushSyncQueueUseCase } = await import('../../src/application/usecases/PushSyncQueueUseCase');
    const { silentLogger } = await import('../support/harness');
    const gw = new HttpApiGateway(new HttpClient({ baseUrl: 'http://x/api/v1', fetchFn: h.server.fetch, tokens: h.tokens, deviceUuid: () => Promise.resolve('d'), logger: silentLogger }));
    const push = new PushSyncQueueUseCase({ gateway: gw, uow: h.uow, session: h.session, clock: h.clock, logger: silentLogger });
    const ac = new AbortController();
    const running = push.execute(ac.signal);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const s = await running;
    expect(s.status).toBe('INTERRUPTED');
    expect(await queueRow(h, sale.uuid)).toMatchObject({ status: 'PENDING', attempts: 0 });
  });
});
