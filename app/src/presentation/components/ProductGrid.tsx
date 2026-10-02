import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import type { ProductWithStock } from '../../domain/entities/Product';
import { peso } from '../utils/format';

const CARD_MIN_WIDTH = 170;
const ROW_HEIGHT = 112;

/** Virtualized product grid (rows of cards) with infinite loading. */
export function ProductGrid(props: {
  items: readonly ProductWithStock[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (p: ProductWithStock) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setColumns(Math.max(1, Math.floor(el.clientWidth / CARD_MIN_WIDTH)));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const rowCount = Math.ceil(props.items.length / columns);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is designed for this
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows[virtualRows.length - 1];
  const { hasMore, loadingMore, onLoadMore } = props;

  useEffect(() => {
    if (lastRow && lastRow.index >= rowCount - 2 && hasMore && !loadingMore) onLoadMore();
  }, [lastRow, rowCount, hasMore, loadingMore, onLoadMore]);

  if (props.items.length === 0) {
    return <div className="empty">No products found.</div>;
  }

  return (
    <div ref={parentRef} className="product-grid" data-testid="product-grid">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            className="product-grid__row"
            style={{
              transform: `translateY(${String(row.start)}px)`,
              height: ROW_HEIGHT,
              gridTemplateColumns: `repeat(${String(columns)}, 1fr)`,
            }}
          >
            {props.items.slice(row.index * columns, row.index * columns + columns).map((p) => {
              const out = p.trackStock && (p.quantityOnHand ?? 0) <= 0;
              return (
                <button
                  key={p.uuid}
                  type="button"
                  className={`product-card ${out ? 'product-card--out' : ''}`}
                  data-testid="product-card"
                  data-name={p.name}
                  onClick={() => {
                    props.onSelect(p);
                  }}
                >
                  <span className="product-card__name">{p.name}</span>
                  <span className="product-card__price">{peso(p.price)}</span>
                  <span className="product-card__meta">
                    {p.sku}
                    {p.trackStock ? ` · ${String(p.quantityOnHand ?? 0)} left` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
