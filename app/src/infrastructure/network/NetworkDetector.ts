import type { HealthGateway } from '../../application/ports/Gateways';
import type { Logger } from '../../application/ports/Logger';
import type { NetworkState, NetworkStatusProvider } from '../../application/ports/Network';

/** OS-level connectivity (Capacitor Network plugin on Android, navigator.onLine on web). */
export interface ConnectivitySource {
  isConnected(): Promise<boolean>;
  onChange(listener: (connected: boolean) => void): () => void;
}

/**
 * OFFLINE  = OS reports no network.
 * UNSTABLE = network present but GET /health failed or was slow (captive portal, server down).
 * ONLINE   = network present and /health answered OK.
 * Probes on every OS change and periodically (30s when degraded, 120s when online).
 */
export class NetworkDetector implements NetworkStatusProvider {
  private state: NetworkState = 'OFFLINE';
  private readonly listeners = new Set<(s: NetworkState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private probing: Promise<NetworkState> | null = null;

  constructor(
    private readonly source: ConnectivitySource,
    private readonly health: HealthGateway,
    private readonly logger: Logger,
    private readonly options = { probeTimeoutMs: 4000, degradedIntervalMs: 30_000, onlineIntervalMs: 120_000 },
  ) {}

  current(): NetworkState {
    return this.state;
  }

  subscribe(listener: (s: NetworkState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    this.unsubscribe = this.source.onChange((connected) => {
      if (!connected) this.set('OFFLINE');
      void this.refresh();
    });
    await this.refresh();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  refresh(): Promise<NetworkState> {
    this.probing ??= this.probe().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async probe(): Promise<NetworkState> {
    let next: NetworkState;
    if (!(await this.source.isConnected())) next = 'OFFLINE';
    else next = (await this.health.check(this.options.probeTimeoutMs)) ? 'ONLINE' : 'UNSTABLE';
    // The OS may have flipped while we were probing.
    if (next !== 'OFFLINE' && !(await this.source.isConnected())) next = 'OFFLINE';
    this.set(next);
    this.schedule();
    return next;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = this.state === 'ONLINE' ? this.options.onlineIntervalMs : this.options.degradedIntervalMs;
    this.timer = setTimeout(() => {
      void this.refresh();
    }, delay);
  }

  private set(next: NetworkState): void {
    if (next === this.state) return;
    this.logger.info('Network state changed', { from: this.state, to: next });
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}
