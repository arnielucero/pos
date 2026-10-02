import { useState } from 'react';
import type { Discount, DiscountType } from '../../domain/entities/Sale';
import { Money } from '../../domain/valueObjects/Money';
import { Modal } from './Modal';

/** Collects a PERCENT (basis points) or AMOUNT (centavos) discount. */
export function DiscountDialog(props: {
  title: string;
  initial: Discount | null;
  onApply: (d: Discount | null) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<DiscountType>(props.initial?.type ?? 'PERCENT');
  const [raw, setRaw] = useState(() => {
    if (!props.initial) return '';
    return props.initial.type === 'PERCENT' ? String(props.initial.value / 100) : (props.initial.value / 100).toFixed(2);
  });
  const parsed = ((): Discount | null => {
    if (type === 'PERCENT') {
      const pct = Number(raw);
      if (!raw || Number.isNaN(pct) || pct < 0 || pct > 100) return null;
      return { type, value: Math.round(pct * 100) };
    }
    const m = Money.parsePesos(raw);
    return m ? { type, value: m.centavos } : null;
  })();
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              props.onApply(null);
            }}
          >
            Remove discount
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!parsed}
            onClick={() => {
              props.onApply(parsed);
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="segmented">
        {(['PERCENT', 'AMOUNT'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn ${type === t ? 'btn--selected' : ''}`}
            onClick={() => {
              setType(t);
            }}
          >
            {t === 'PERCENT' ? 'Percent %' : 'Amount ₱'}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{type === 'PERCENT' ? 'Percent (e.g. 10 or 12.5)' : 'Amount in pesos'}</span>
        <input
          autoFocus
          inputMode="decimal"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
          }}
        />
      </label>
    </Modal>
  );
}
