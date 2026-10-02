export type NetworkState = 'ONLINE' | 'OFFLINE' | 'UNSTABLE';

export interface NetworkStatusProvider {
  current(): NetworkState;
  subscribe(listener: (state: NetworkState) => void): () => void;
  /** Re-evaluates connectivity now (OS status + /health probe). */
  refresh(): Promise<NetworkState>;
}

export interface SyncTrigger {
  /** Non-blocking request to run a sync soon. */
  nudge(reason: string): void;
}
