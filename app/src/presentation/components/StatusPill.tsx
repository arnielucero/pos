import { useNetworkState, useSyncState } from '../hooks/useAppState';
import { formatTime } from '../utils/format';

/** "🟢 Synced · Last sync 09:42" / "🔴 Offline · 5 pending" / "⚠ Sync error". */
export function StatusPill() {
  const sync = useSyncState();
  const network = useNetworkState();
  const pending = sync.counts.pending + sync.counts.inFlight;
  let tone = 'ok';
  let text: string;
  if (network === 'OFFLINE') {
    tone = 'offline';
    text = `🔴 Offline · ${String(pending)} pending`;
  } else if (sync.phase === 'AUTH_REQUIRED') {
    tone = 'warn';
    text = '⚠ Sign in again to sync';
  } else if (sync.phase === 'ERROR' || sync.counts.failed > 0) {
    tone = 'warn';
    text = '⚠ Sync error';
  } else if (sync.phase === 'SYNCING') {
    tone = 'busy';
    text = `🔄 Syncing · ${String(pending)} pending`;
  } else if (network === 'UNSTABLE') {
    tone = 'warn';
    text = `🟠 Unstable · ${String(pending)} pending`;
  } else if (pending > 0) {
    tone = 'busy';
    text = `🟡 ${String(pending)} pending`;
  } else {
    text = `🟢 Synced · Last sync ${formatTime(sync.lastSyncAt)}`;
  }
  return (
    <span className={`status-pill status-pill--${tone}`} data-testid="sync-status" data-pending={pending} data-network={network}>
      {text}
    </span>
  );
}

export function OfflineBanner() {
  const network = useNetworkState();
  const sync = useSyncState();
  if (network !== 'OFFLINE') return null;
  const pending = sync.counts.pending + sync.counts.inFlight;
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      You are offline. Sales continue normally. {pending} transactions pending.
    </div>
  );
}
