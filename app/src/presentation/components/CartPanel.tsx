import { useState } from 'react';
import type { Discount } from '../../domain/entities/Sale';
import { formatBasisPoints } from '../../domain/valueObjects/BasisPoints';
import { useCartTotals } from '../hooks/useCartTotals';
import { useCartStore, type CartLine } from '../stores/cartStore';
import { peso } from '../utils/format';
import { DiscountDialog } from './DiscountDialog';

function describe(d: Discount | null): string {
  if (!d) return '';
  return d.type === 'PERCENT' ? `-${formatBasisPoints(d.value)}` : `-${peso(d.value)}`;
}

export function CartPanel(props: {
  onPay: (method: string) => void;
  onDiscount: (target: { line: CartLine } | { order: true }, discount: Discount | null) => void;
  methods: readonly { code: string; label: string }[];
  disabled: boolean;
}) {
  const lines = useCartStore((s) => s.lines);
  const orderDiscount = useCartStore((s) => s.orderDiscount);
  const increment = useCartStore((s) => s.increment);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);
  const totals = useCartTotals();
  const [editing, setEditing] = useState<{ line: CartLine } | { order: true } | null>(null);

  return (
    <aside className="cart" data-testid="cart">
      <div className="cart__header">
        <h2>Cart</h2>
        {lines.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <ul className="cart__lines">
        {lines.length === 0 && <li className="empty">Tap a product to add it.</li>}
        {lines.map((l, i) => {
          const priced = totals?.lines[i];
          const short = l.trackStock && l.available !== null && l.quantity > l.available;
          return (
            <li key={l.productUuid} className="cart-line" data-testid="cart-line" data-name={l.name}>
              <div className="cart-line__info">
                <span className="cart-line__name">{l.name}</span>
                <span className="muted">
                  {peso(l.unitPrice)} {l.discount && <span className="tag">{describe(l.discount)}</span>}
                  {short && <span className="tag tag--warn">only {l.available} in stock</span>}
                </span>
              </div>
              <div className="qty">
                <button
                  type="button"
                  className="btn qty__btn"
                  aria-label={`Decrease ${l.name}`}
                  onClick={() => {
                    increment(l.productUuid, -1);
                  }}
                >
                  −
                </button>
                <span className="qty__value" data-testid="cart-qty">
                  {l.quantity}
                </span>
                <button
                  type="button"
                  className="btn qty__btn"
                  aria-label={`Increase ${l.name}`}
                  onClick={() => {
                    increment(l.productUuid, 1);
                  }}
                >
                  +
                </button>
              </div>
              <div className="cart-line__total">
                <span>{peso(priced?.lineTotal ?? l.unitPrice * l.quantity)}</span>
                <span className="cart-line__actions">
                  <button
                    type="button"
                    className="btn btn--link"
                    onClick={() => {
                      setEditing({ line: l });
                    }}
                  >
                    Disc.
                  </button>
                  <button
                    type="button"
                    className="btn btn--link"
                    onClick={() => {
                      remove(l.productUuid);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <dl className="totals">
        <dt>Subtotal</dt>
        <dd>{peso(totals?.subtotal ?? 0)}</dd>
        <dt>
          <button
            type="button"
            className="btn btn--link"
            disabled={lines.length === 0}
            onClick={() => {
              setEditing({ order: true });
            }}
          >
            Order discount {orderDiscount ? describe(orderDiscount) : ''}
          </button>
        </dt>
        <dd>-{peso(totals?.discountTotal ?? 0)}</dd>
        <dt className="muted">VAT (incl.)</dt>
        <dd className="muted">{peso(totals?.taxTotal ?? 0)}</dd>
        <dt className="totals__grand">Total</dt>
        <dd className="totals__grand" data-testid="cart-total">
          {peso(totals?.total ?? 0)}
        </dd>
      </dl>
      <div className="pay-buttons">
        {props.methods.map((m) => (
          <button
            key={m.code}
            type="button"
            className={`btn btn--pay btn--pay-${m.code.toLowerCase()}`}
            data-testid={`pay-${m.code.toLowerCase()}`}
            disabled={props.disabled || lines.length === 0}
            onClick={() => {
              props.onPay(m.code);
            }}
          >
            {m.label.toUpperCase()}
          </button>
        ))}
      </div>
      {editing && (
        <DiscountDialog
          title={'order' in editing ? 'Order discount' : `Discount · ${editing.line.name}`}
          initial={'order' in editing ? orderDiscount : editing.line.discount}
          onClose={() => {
            setEditing(null);
          }}
          onApply={(d) => {
            props.onDiscount(editing, d);
            setEditing(null);
          }}
        />
      )}
    </aside>
  );
}
