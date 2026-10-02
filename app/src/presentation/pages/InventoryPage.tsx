import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import type { ProductWithStock } from '../../domain/entities/Product';
import { Modal } from '../components/Modal';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { useDebouncedValue } from '../hooks/useAppState';
import { useProductSearch } from '../hooks/useCatalog';
import { toUserMessage } from '../utils/errors';
import { formatDateTime, peso } from '../utils/format';

type AdjustType = 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';

export function InventoryPage() {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, 200);
  const search = useProductSearch(debounced, null);
  const [adjusting, setAdjusting] = useState<ProductWithStock | null>(null);
  const [selected, setSelected] = useState<ProductWithStock | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const items = search.items;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is designed for this
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => parentRef.current, estimateSize: () => 52, overscan: 8 });
  const last = virtualizer.getVirtualItems().at(-1);
  if (last && last.index >= items.length - 5 && search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();

  return (
    <div className="split">
      <section className="split__main">
        <div className="filters">
          <input
            type="search"
            placeholder="Search products"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
          />
        </div>
        <div ref={parentRef} className="vlist">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const p = items[row.index];
              if (!p) return null;
              return (
                <div
                  key={p.uuid}
                  className={`vlist__row ${selected?.uuid === p.uuid ? 'vlist__row--on' : ''}`}
                  style={{ transform: `translateY(${String(row.start)}px)`, height: row.size }}
                  onClick={() => {
                    setSelected(p);
                  }}
                >
                  <span>{p.name}</span>
                  <span className="mono muted">{p.sku}</span>
                  <span>{peso(p.price)}</span>
                  <span className="right strong">{p.trackStock ? (p.quantityOnHand ?? 0) : '—'}</span>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdjusting(p);
                    }}
                  >
                    Adjust
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="split__side">{selected ? <Movements product={selected} /> : <div className="empty">Select a product.</div>}</section>
      {adjusting && (
        <AdjustDialog
          product={adjusting}
          onClose={() => {
            setAdjusting(null);
          }}
        />
      )}
    </div>
  );
}

function Movements({ product }: { product: ProductWithStock }) {
  const { useCases } = useContainer();
  const q = useQuery({ queryKey: ['products', 'movements', product.uuid], queryFn: () => useCases.inventory.movements(product.uuid) });
  return (
    <div className="detail">
      <h2>{product.name}</h2>
      <p className="muted">On hand: {product.trackStock ? (product.quantityOnHand ?? 0) : 'not tracked'}</p>
      <table className="table">
        <tbody>
          {(q.data ?? []).map((m) => (
            <tr key={m.uuid}>
              <td>{formatDateTime(m.createdAt)}</td>
              <td>{m.type}</td>
              <td className="right">{m.quantity > 0 ? `+${String(m.quantity)}` : m.quantity}</td>
              <td className="muted">{m.syncStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustDialog({ product, onClose }: { product: ProductWithStock; onClose: () => void }) {
  const { useCases } = useContainer();
  const withApproval = useApproval();
  const client = useQueryClient();
  const [type, setType] = useState<AdjustType>('STOCK_IN');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    const n = Number.parseInt(qty, 10);
    if (!Number.isInteger(n) || n === 0) {
      setError('Enter a whole number.');
      return;
    }
    const signed = type === 'STOCK_OUT' ? -Math.abs(n) : type === 'STOCK_IN' ? Math.abs(n) : n;
    try {
      const res = await withApproval(
        (approval) => useCases.adjustInventory.execute({ productUuid: product.uuid, type, quantity: signed, reason, approval }),
        { reason: `Inventory: ${reason}`.slice(0, 255) },
      );
      if (res) {
        await client.invalidateQueries({ queryKey: ['products'] });
        onClose();
      }
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  return (
    <Modal
      title={`Adjust · ${product.name}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={() => void submit()}>
          Save adjustment
        </button>
      }
    >
      <div className="segmented">
        {(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn ${type === t ? 'btn--selected' : ''}`}
            onClick={() => {
              setType(t);
            }}
          >
            {t === 'STOCK_IN' ? 'Stock in' : t === 'STOCK_OUT' ? 'Stock out' : 'Correction (±)'}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Quantity{type === 'ADJUSTMENT' ? ' (negative removes)' : ''}</span>
        <input
          inputMode="numeric"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
          }}
        />
      </label>
      <label className="field">
        <span>Reason</span>
        <input
          value={reason}
          maxLength={255}
          placeholder="e.g. Delivery, Damaged, Count correction"
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
