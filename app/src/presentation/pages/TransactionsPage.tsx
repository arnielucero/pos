import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import type { SaleSummary, SaleSyncStatus } from '../../domain/entities/Sale';
import { Modal } from '../components/Modal';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { useDebouncedValue } from '../hooks/useAppState';
import { toUserMessage } from '../utils/errors';
import { formatDateTime, peso } from '../utils/format';

const PAGE = 500;

export function TransactionsPage() {
  const { useCases } = useContainer();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'COMPLETED' | 'VOIDED'>('ALL');
  const [syncStatus, setSyncStatus] = useState<'ALL' | SaleSyncStatus>('ALL');
  const [selected, setSelected] = useState<string | null>(null);
  const debounced = useDebouncedValue(search, 250);
  const list = useQuery({
    queryKey: ['sales', debounced, status, syncStatus],
    queryFn: () => useCases.transactions.list({ search: debounced, status, syncStatus, limit: PAGE, offset: 0 }),
  });
  const items = list.data ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is designed for this
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => parentRef.current, estimateSize: () => 56, overscan: 8 });

  return (
    <div className="split">
      <section className="split__main">
        <div className="filters">
          <input
            type="search"
            placeholder="Receipt no. or cashier"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
            }}
          >
            <option value="ALL">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </select>
          <select
            value={syncStatus}
            onChange={(e) => {
              setSyncStatus(e.target.value as typeof syncStatus);
            }}
          >
            <option value="ALL">Any sync state</option>
            <option value="PENDING">Pending</option>
            <option value="SYNCED">Synced</option>
            <option value="FLAGGED">Flagged</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div ref={parentRef} className="vlist" data-testid="transactions-list">
          {items.length === 0 && <div className="empty">No transactions.</div>}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const s = items[row.index];
              if (!s) return null;
              return (
                <button
                  key={s.uuid}
                  type="button"
                  className={`vlist__row ${selected === s.uuid ? 'vlist__row--on' : ''}`}
                  style={{ transform: `translateY(${String(row.start)}px)`, height: row.size }}
                  data-testid="transaction-row"
                  data-receipt={s.receiptNumber}
                  onClick={() => {
                    setSelected(s.uuid);
                  }}
                >
                  <span className="mono">{s.receiptNumber}</span>
                  <span>{formatDateTime(s.createdAt)}</span>
                  <span>{s.cashierName}</span>
                  <span className="right">{peso(s.total)}</span>
                  <SaleBadges sale={s} />
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section className="split__side">
        {selected ? (
          <SaleDetail
            uuid={selected}
            onChanged={() => {
              void list.refetch();
            }}
          />
        ) : (
          <div className="empty">Select a transaction.</div>
        )}
      </section>
    </div>
  );
}

function SaleBadges({ sale }: { sale: SaleSummary }) {
  return (
    <span className="badges">
      {sale.status === 'VOIDED' && <span className="tag tag--warn">VOIDED</span>}
      <span className={`tag tag--sync-${sale.syncStatus.toLowerCase()}`} data-testid="sale-sync-status">
        {sale.syncStatus}
      </span>
      {sale.printStatus === 'FAILED' && <span className="tag tag--warn">NOT PRINTED</span>}
    </span>
  );
}

function SaleDetail({ uuid, onChanged }: { uuid: string; onChanged: () => void }) {
  const { useCases } = useContainer();
  const withApproval = useApproval();
  const client = useQueryClient();
  const sale = useQuery({ queryKey: ['sales', 'detail', uuid], queryFn: () => useCases.transactions.get(uuid) });
  const [message, setMessage] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const s = sale.data;
  if (!s) return <div className="empty">Loading…</div>;

  const reprint = async (): Promise<void> => {
    setMessage(null);
    try {
      const res = await withApproval((approval) => useCases.reprintReceipt.execute(s.uuid, approval), { reason: 'Reprint receipt' });
      if (res) setMessage(res.ok ? 'Receipt reprinted.' : `Print failed: ${res.error.message}`);
    } catch (e) {
      setMessage(toUserMessage(e));
    }
  };

  const doVoid = async (): Promise<void> => {
    setMessage(null);
    try {
      const res = await withApproval(
        async (approval) => {
          await useCases.voidSale.execute({ saleUuid: s.uuid, reason, approval });
          return true;
        },
        { reason: `Void ${s.receiptNumber}: ${reason}`.slice(0, 255) },
      );
      if (res) {
        setVoiding(false);
        setMessage('Sale voided.');
        await client.invalidateQueries({ queryKey: ['sales'] });
        await client.invalidateQueries({ queryKey: ['products'] });
        onChanged();
      }
    } catch (e) {
      setMessage(toUserMessage(e));
    }
  };

  return (
    <div className="detail" data-testid="sale-detail">
      <h2 className="mono">{s.receiptNumber}</h2>
      <p className="muted">
        {formatDateTime(s.createdAt)} · {s.cashierName}
      </p>
      <SaleBadges sale={s} />
      <table className="table">
        <tbody>
          {s.items.map((i) => (
            <tr key={i.uuid}>
              <td>
                {i.quantity} × {i.name}
              </td>
              <td className="right">{peso(i.lineTotal)}</td>
            </tr>
          ))}
          <tr>
            <td>Discounts</td>
            <td className="right">-{peso(s.discountTotal)}</td>
          </tr>
          <tr className="strong">
            <td>Total</td>
            <td className="right">{peso(s.total)}</td>
          </tr>
          {s.payments.map((p) => (
            <tr key={p.uuid} className="muted">
              <td>
                {p.method}
                {p.reference ? ` · ${p.reference}` : ''}
              </td>
              <td className="right">
                {peso(p.tendered)}
                {p.change > 0 ? ` (change ${peso(p.change)})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.voidReason && <p className="muted">Void reason: {s.voidReason}</p>}
      <div className="actions">
        <button type="button" className="btn" data-testid="reprint" onClick={() => void reprint()}>
          Reprint
        </button>
        {s.status === 'COMPLETED' && (
          <button
            type="button"
            className="btn btn--danger"
            data-testid="void"
            onClick={() => {
              setVoiding(true);
            }}
          >
            Void sale
          </button>
        )}
      </div>
      {message && (
        <p className="notice" role="status" data-testid="sale-message">
          {message}
        </p>
      )}
      {voiding && (
        <Modal
          title={`Void ${s.receiptNumber}`}
          onClose={() => {
            setVoiding(false);
          }}
          footer={
            <button
              type="button"
              className="btn btn--danger"
              data-testid="confirm-void"
              disabled={reason.trim().length < 3}
              onClick={() => void doVoid()}
            >
              Void sale
            </button>
          }
        >
          <label className="field">
            <span>Reason</span>
            <input
              autoFocus
              data-testid="void-reason"
              value={reason}
              maxLength={255}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </label>
        </Modal>
      )}
    </div>
  );
}
