import type { Logger } from '../../application/ports/Logger';
import type { NetworkState, NetworkStatusProvider, SyncTrigger } from '../../application/ports/Network';
import type { SessionManager } from '../../application/session/SessionManager';
import type { PullCatalogUseCase } from '../../application/usecases/PullCatalogUseCase';
import type { PushSummary, PushSyncQueueUseCase } from '../../application/usecases/PushSyncQueueUseCase';
import type { SyncCounts } from '../../domain/entities/Sync';
import type { SyncQueue } from '../../domain/repositories/SyncQueue';

export type SyncPhase = 'IDLE' | 'SYNCING' | 'OFFLINE' | 'ERROR' | 'AUTH_REQUIRED';

export interface SyncEngineState {
  readonly phase: SyncPhase;
  readonly network: NetworkState;
  readonly lastSyncAt: string | null;
  readonly lastError: string | null;
  readonly counts: SyncCounts;
  readonly lastPush: PushSummary | null;
}

export interface SyncEngineOptions {
  readonly periodicMs: number;
  readonly pullEveryRun: boolean;
}

const EMPTY_COUNTS: SyncCounts = { pending: 0, inFlight: 0, failed: 0, flaggedSales: 0 };

/**
 * Orchestrates push + pull with:
 *  - single-flight lock (concurrent triggers coalesce into one follow-up run),
 *  - interruptible runs (stop() aborts in-flight HTTP; claimed items are released),
 *  - crash recovery (IN_FLIGHT → PENDING once at start),
 *  - triggers: start, login, network regained, 60s periodic timer, manual button, and a
 *    wake-up timer at the next backoff deadline.
 */
export class SyncEngine implements SyncTrigger {
  private state: SyncEngineState;
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private abort: AbortController | null = null;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private wakeup: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private started = false;

  constructor(
    private readonly deps: {
      push: PushSyncQueueUseCase;
      pull: PullCatalogUseCase;
      queue: SyncQueue;
      network: NetworkStatusProvider;
      session: SessionManager;
      logger: Logger;
      now?: () => Date;
    },
    private readonly options: SyncEngineOptions = { periodicMs: 60_000, pullEveryRun: true },
  ) {
    this.state = {
      phase: 'IDLE',
      network: deps.network.current(),
      lastSyncAt: null,
      lastError: null,
      counts: EMPTY_COUNTS,
      lastPush: null,
    };
  }

  getState = (): SyncEngineState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private patch(p: Partial<SyncEngineState>): void {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /** Crash recovery + triggers. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const reset = await this.deps.queue.resetInFlight();
    if (reset > 0) this.deps.logger.warning('Recovered interrupted sync operations', { count: reset });
    await this.refreshCounts();
    let previous = this.deps.network.current();
    this.unsubscribeNetwork = this.deps.network.subscribe((s) => {
      this.patch({ network: s });
      if (s === 'ONLINE' && previous !== 'ONLINE') this.nudge('network-regained');
      if (s === 'OFFLINE') this.patch({ phase: 'OFFLINE' });
      previous = s;
    });
    this.periodic = setInterval(() => {
      this.nudge('periodic');
    }, this.options.periodicMs);
    this.nudge('app-start');
  }

  /** Stops timers and interrupts the current run (it can be resumed by start()). */
  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribeNetwork?.();
    if (this.periodic) clearInterval(this.periodic);
    if (this.wakeup) clearTimeout(this.wakeup);
    this.periodic = null;
    this.wakeup = null;
    this.abort?.abort();
    await this.running?.catch(() => undefined);
  }

  nudge(reason: string): void {
    void this.syncNow(reason).catch((e: unknown) => {
      this.deps.logger.error('Sync run crashed', { reason, error: String(e) });
    });
  }

  /** Runs a sync (or joins the current one and schedules exactly one follow-up run). */
  syncNow(reason: string): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.loop(reason).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async refreshCounts(): Promise<SyncCounts> {
    const counts = await this.deps.queue.counts();
    this.patch({ counts });
    return counts;
  }

  private async loop(reason: string): Promise<void> {
    let r = reason;
    for (let i = 0; i < 5; i++) {
      this.rerun = false;
      await this.runOnce(r);
      if (!this.rerun) break;
      r = 'coalesced';
    }
  }

  private async runOnce(reason: string): Promise<void> {
    const d = this.deps;
    const network = d.network.current();
    this.patch({ network });
    if (!d.session.getState().device) return; // unregistered device: nothing can sync yet
    if (network === 'OFFLINE') {
      this.patch({ phase: 'OFFLINE' });
      await this.refreshCounts();
      return;
    }
    if (d.session.getState().reauthRequired) {
      this.patch({ phase: 'AUTH_REQUIRED' });
      await this.refreshCounts();
      return;
    }
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.patch({ phase: 'SYNCING' });
    d.logger.debug('Sync run started', { reason });
    try {
      const push = await d.push.execute(signal);
      this.patch({ lastPush: push });
      if (push.status === 'AUTH_REQUIRED') {
        this.patch({ phase: 'AUTH_REQUIRED', lastError: push.lastError });
        return;
      }
      if (push.status === 'INTERRUPTED') {
        this.patch({ phase: 'IDLE' });
        return;
      }
      if (push.status === 'OFFLINE' || push.status === 'SERVER_ERROR' || push.status === 'BLOCKED') {
        this.patch({ phase: push.status === 'OFFLINE' ? 'OFFLINE' : 'ERROR', lastError: push.lastError });
        void d.network.refresh();
        return;
      }
      if (this.options.pullEveryRun) await d.pull.execute(signal);
      const counts = await d.queue.counts();
      this.patch({
        phase: counts.failed > 0 ? 'ERROR' : 'IDLE',
        lastError: counts.failed > 0 ? `${String(counts.failed)} operation(s) failed` : null,
        lastSyncAt: (d.now ?? (() => new Date()))().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const authLost = typeof e === 'object' && e !== null && 'kind' in e && e.kind === 'AUTH_REQUIRED';
      if (authLost) d.session.update({ reauthRequired: true });
      this.patch({ phase: authLost ? 'AUTH_REQUIRED' : 'ERROR', lastError: msg });
      d.logger.warning('Sync run failed', { reason, error: msg });
    } finally {
      this.abort = null;
      await this.refreshCounts().catch(() => undefined);
      await this.scheduleWakeup();
    }
  }

  /** Wakes up at the earliest backoff deadline (bounded by the periodic timer). */
  private async scheduleWakeup(): Promise<void> {
    if (!this.started) return;
    if (this.wakeup) clearTimeout(this.wakeup);
    this.wakeup = null;
    const next = await this.deps.queue.nextDueAt();
    if (!next) return;
    const delay = Math.max(1000, Date.parse(next) - Date.now());
    if (delay >= this.options.periodicMs) return;
    this.wakeup = setTimeout(() => {
      this.nudge('backoff-due');
    }, delay);
  }
}
