import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useContainer } from '../hooks/ContainerContext';
import { useNetworkState, useSyncState } from '../hooks/useAppState';
import { toUserMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';

export function SyncStatusPage() {
  const container = useContainer();
  const sync = useSyncState();
  const network = useNetworkState();
  const [message, setMessage] = useState<string | null>(null);
  const canDiagnose = container.useCases.syncStatus.canViewDiagnostics();
  const diagnostics = useQuery({
    queryKey: ['sync-diagnostics', sync.lastSyncAt, sync.counts.failed, sync.counts.pending],
    queryFn: () => container.useCases.syncStatus.diagnostics(),
    enabled: canDiagnose,
  });

  const syncNow = async (): Promise<void> => {
    setMessage(null);
    await container.network.refresh();
    await container.sync.syncNow('manual');
    setMessage(container.sync.getState().lastError ?? 'Sync finished.');
  };

  const requeue = async (id: number): Promise<void> => {
    try {
      await container.useCases.syncStatus.requeue(id);
      container.sync.nudge('requeue');
      void diagnostics.refetch();
    } catch (e) {
      setMessage(toUserMessage(e));
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Sync status</h2>
        <dl className="kv">
          <dt>Network</dt>
          <dd data-testid="sync-network">{network}</dd>
          <dt>State</dt>
          <dd data-testid="sync-phase">{sync.phase}</dd>
          <dt>Pending</dt>
          <dd data-testid="sync-pending">{sync.counts.pending + sync.counts.inFlight}</dd>
          <dt>Failed</dt>
          <dd data-testid="sync-failed">{sync.counts.failed}</dd>
          <dt>Flagged sales</dt>
          <dd>{sync.counts.flaggedSales}</dd>
          <dt>Last sync</dt>
          <dd>{formatDateTime(sync.lastSyncAt)}</dd>
          {sync.lastError && (
            <>
              <dt>Last error</dt>
              <dd className="error-text">{sync.lastError}</dd>
            </>
          )}
        </dl>
        <button type="button" className="btn btn--primary" data-testid="sync-now" disabled={sync.phase === 'SYNCING'} onClick={() => void syncNow()}>
          {sync.phase === 'SYNCING' ? 'Syncing…' : 'Sync now'}
        </button>
        {message && <p className="notice">{message}</p>}
      </div>
      {canDiagnose && diagnostics.data && (
        <div className="card" data-testid="sync-diagnostics">
          <h2>Diagnostics</h2>
          <h3>Failed operations ({diagnostics.data.failed.length})</h3>
          <table className="table">
            <tbody>
              {diagnostics.data.failed.map((f) => (
                <tr key={f.id}>
                  <td>{f.operation}</td>
                  <td className="mono">{f.uuid.slice(0, 8)}</td>
                  <td>{f.errorCode}</td>
                  <td>{f.errorMessage}</td>
                  <td>{f.attempts}</td>
                  <td>
                    <button type="button" className="btn btn--small" onClick={() => void requeue(f.id)}>
                      Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Pending operations ({diagnostics.data.pending.length})</h3>
          <table className="table">
            <tbody>
              {diagnostics.data.pending.map((f) => (
                <tr key={f.id}>
                  <td>{f.operation}</td>
                  <td className="mono">{f.uuid.slice(0, 8)}</td>
                  <td>attempts {f.attempts}</td>
                  <td>{f.errorCode ?? ''}</td>
                  <td>next {formatDateTime(f.nextRetryAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Conflicts ({diagnostics.data.conflicts.length})</h3>
          <table className="table">
            <tbody>
              {diagnostics.data.conflicts.map((c) => (
                <tr key={c.id}>
                  <td>{c.conflictType}</td>
                  <td>{c.entityType}</td>
                  <td className="mono">{c.entityId.slice(0, 8)}</td>
                  <td>
                    {c.localVersion} → {c.serverVersion}
                  </td>
                  <td>{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Recent log</h3>
          <pre className="log">
            {(container.memoryLog?.records() ?? [])
              .slice(-40)
              .map((r) => `${r.ts} ${r.level} ${r.scope} ${r.message}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
