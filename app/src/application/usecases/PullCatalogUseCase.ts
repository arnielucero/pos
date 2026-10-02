import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import type { SettingsRepository } from '../../domain/repositories/SettingsRepository';
import type { Clock } from '../ports/Clock';
import type { SyncGateway } from '../ports/Gateways';
import type { Logger } from '../ports/Logger';
import { SETTINGS_CATALOG_SYNCED_AT } from './CompleteSaleUseCase';

export const SETTINGS_PULL_SINCE = 'sync.pull_since';
const OVERLAP_MS = 2 * 60_000;
const MAX_PAGES = 2000;

export interface PullSummary {
  readonly pages: number;
  readonly products: number;
  readonly inventory: number;
  readonly approvers: number;
  readonly serverTime: string | null;
}

/**
 * Incremental catalog download (GET /sync/pull). Each page is applied in its own transaction
 * (idempotent upserts), and the cursor only advances after the LAST page, to the FIRST page's
 * server_time minus a 2-minute overlap. Inventory merges keep unsynced local movements.
 */
export class PullCatalogUseCase {
  constructor(
    private readonly deps: {
      gateway: SyncGateway;
      uow: UnitOfWork;
      settings: SettingsRepository;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(signal?: AbortSignal): Promise<PullSummary> {
    const d = this.deps;
    const since = await d.settings.get(SETTINGS_PULL_SINCE);
    let page = 1;
    let firstServerTime: string | null = null;
    let products = 0;
    let inventory = 0;
    let approvers = 0;
    for (;;) {
      if (signal?.aborted) throw new DOMException('Pull aborted', 'AbortError');
      const res = await d.gateway.pull(since, page, signal);
      firstServerTime ??= res.serverTime;
      await d.uow.run(async (r) => {
        if (res.products.length) await r.productWriter.upsertMany(res.products);
        if (res.inventory.length) await r.inventory.applyServerBalances(res.inventory);
        if (res.approvers.length) await r.approvers.upsertMany(res.approvers);
        if (res.settings) await r.settings.saveStoreSettings(res.settings);
      });
      products += res.products.length;
      inventory += res.inventory.length;
      approvers += res.approvers.length;
      if (!res.hasMore || page >= MAX_PAGES) break;
      page += 1;
    }
    const cursor = new Date(Date.parse(firstServerTime) - OVERLAP_MS).toISOString();
    await d.uow.run(async (r) => {
      await r.settings.set(SETTINGS_PULL_SINCE, cursor);
      await r.settings.set(SETTINGS_CATALOG_SYNCED_AT, firstServerTime);
    });
    d.logger.info('Catalog pull complete', { pages: page, products, inventory, approvers });
    return { pages: page, products, inventory, approvers, serverTime: firstServerTime };
  }
}
