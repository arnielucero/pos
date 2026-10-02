import { PullCatalogUseCase } from '../../src/application/usecases/PullCatalogUseCase';
import { PushSyncQueueUseCase } from '../../src/application/usecases/PushSyncQueueUseCase';
import { HttpApiGateway } from '../../src/infrastructure/api/HttpApiGateway';
import { HttpClient } from '../../src/infrastructure/api/HttpClient';
import { MemorySecureStore } from '../../src/infrastructure/authentication/SecureStores';
import { SecureTokenStore } from '../../src/infrastructure/authentication/SecureTokenStore';
import { SqliteUnitOfWork } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { SyncEngine } from '../../src/infrastructure/synchronization/SyncEngine';
import { FakeApiServer } from './fakeServer';
import { DEVICE, FakeNetwork, saleHarness, silentLogger } from './harness';

/** Sale harness + real HttpClient/gateway/push/pull/engine against an in-process fake API. */
export async function syncHarness() {
  const h = await saleHarness();
  const server = new FakeApiServer();
  const tokens = new SecureTokenStore(new MemorySecureStore());
  await tokens.save({ accessToken: 'access-1', accessExpiresAt: '2099-01-01T00:00:00Z', refreshToken: 'refresh-1', refreshExpiresAt: '2099-01-01T00:00:00Z' });
  const http = new HttpClient({
    baseUrl: 'http://api.test/api/v1',
    fetchFn: server.fetch,
    tokens,
    deviceUuid: () => Promise.resolve(DEVICE.uuid),
    logger: silentLogger,
    now: () => h.clock.now(),
    onAuthLost: () => {
      h.session.update({ reauthRequired: true });
    },
  });
  const gateway = new HttpApiGateway(http);
  const uow = new SqliteUnitOfWork(h.db);
  const push = new PushSyncQueueUseCase({ gateway, uow, session: h.session, clock: h.clock, logger: silentLogger });
  const pull = new PullCatalogUseCase({ gateway, uow, settings: h.repos.settings, clock: h.clock, logger: silentLogger });
  const network = new FakeNetwork('ONLINE');
  const engine = new SyncEngine(
    { push, pull, queue: h.repos.syncQueue, network, session: h.session, logger: silentLogger, now: () => h.clock.now() },
    { periodicMs: 3_600_000, pullEveryRun: true },
  );
  return { ...h, server, tokens, http, gateway, push, pull, network, engine };
}
