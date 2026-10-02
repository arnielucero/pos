import { useState } from 'react';
import type { Payment } from '../../domain/entities/Sale';
import { Money } from '../../domain/valueObjects/Money';
import { usePaymentSession } from '../hooks/usePaymentSession';
import { toUserMessage } from '../utils/errors';
import { peso } from '../utils/format';
import { Modal } from './Modal';

const QUICK_CASH = [10000, 20000, 50000, 100000];

/** Split-payment dialog: tendered / change for cash, reference numbers for GCash / card. */
export function PaymentDialog(props: {
  total: number;
  initialMethod: string;
  busy: boolean;
  onCancel: () => void;
  onComplete: (payments: Payment[]) => void;
}) {
  const session = usePaymentSession(props.total);
  const [method, setMethod] = useState(props.initialMethod);
  const [raw, setRaw] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = session.methods.find((m) => m.code === method);

  const tryBuild = (): Payment | null => {
    const amount = raw.trim() === '' && current && !current.producesChange ? session.remaining : (Money.parsePesos(raw)?.centavos ?? null);
    if (amount === null || amount <= 0) {
      setError(current?.producesChange ? 'Enter the cash received.' : 'Enter an amount.');
      return null;
    }
    try {
      return session.build(method, amount, current?.requiresReference ? reference : null);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : toUserMessage(e));
      return null;
    }
  };

  const addCurrent = (): Payment | null => {
    setError(null);
    const p = tryBuild();
    if (p) {
      session.add(p);
      setRaw('');
      setReference('');
    }
    return p;
  };

  const complete = (): void => {
    setError(null);
    if (session.remaining === 0) {
      props.onComplete(session.payments);
      return;
    }
    const p = tryBuild();
    if (!p) return;
    const next = [...session.payments, p];
    if (next.reduce((sum, x) => sum + x.amount, 0) === props.total) {
      props.onComplete(next);
      return;
    }
    // Partial tender (split payment): keep it and wait for the rest.
    session.add(p);
    setRaw('');
    setReference('');
  };

  const pendingChange =
    current?.producesChange && session.remaining > 0
      ? Math.max(0, (Money.parsePesos(raw)?.centavos ?? 0) - session.remaining)
      : 0;

  return (
    <Modal title={`Payment · ${peso(props.total)}`} onClose={props.busy ? undefined : props.onCancel} wide testId="payment-dialog">
      <div className="payment">
        <div className="payment__methods segmented">
          {session.methods.map((m) => (
            <button
              key={m.code}
              type="button"
              className={`btn ${method === m.code ? 'btn--selected' : ''}`}
              data-testid={`method-${m.code.toLowerCase()}`}
              onClick={() => {
                setMethod(m.code);
                setError(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="payment__summary">
          <div>
            <span className="muted">Remaining</span>
            <strong data-testid="payment-remaining">{peso(session.remaining)}</strong>
          </div>
          <div>
            <span className="muted">Change</span>
            <strong data-testid="payment-change">{peso(session.change + pendingChange)}</strong>
          </div>
        </div>
        {session.remaining > 0 && (
          <>
            <label className="field">
              <span>{current?.producesChange ? 'Cash received' : `${current?.label ?? ''} amount (blank = remaining)`}</span>
              <input
                autoFocus
                inputMode="decimal"
                data-testid="payment-amount"
                value={raw}
                placeholder={(session.remaining / 100).toFixed(2)}
                onChange={(e) => {
                  setRaw(e.target.value);
                }}
              />
            </label>
            {current?.producesChange && (
              <div className="quick-cash">
                <button
                  type="button"
                  className="btn"
                  data-testid="cash-exact"
                  onClick={() => {
                    setRaw((session.remaining / 100).toFixed(2));
                  }}
                >
                  Exact
                </button>
                {QUICK_CASH.filter((q) => q >= session.remaining).map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRaw((q / 100).toFixed(2));
                    }}
                  >
                    {peso(q)}
                  </button>
                ))}
              </div>
            )}
            {current?.requiresReference && (
              <label className="field">
                <span>Reference no.</span>
                <input
                  data-testid="payment-reference"
                  value={reference}
                  maxLength={100}
                  onChange={(e) => {
                    setReference(e.target.value);
                  }}
                />
              </label>
            )}
            <button type="button" className="btn" data-testid="payment-add" onClick={addCurrent}>
              Add payment (split)
            </button>
          </>
        )}
        {session.payments.length > 0 && (
          <ul className="payment__list" data-testid="payment-list">
            {session.payments.map((p) => (
              <li key={p.uuid}>
                <span>
                  {p.method} {p.reference ? `· ${p.reference}` : ''}
                </span>
                <span>
                  {peso(p.amount)}
                  {p.change > 0 ? ` (tendered ${peso(p.tendered)}, change ${peso(p.change)})` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn--link"
                  disabled={props.busy}
                  onClick={() => {
                    session.removeAt(p.uuid);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="error-text" role="alert" data-testid="payment-error">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn btn--primary btn--xl"
          data-testid="payment-complete"
          disabled={props.busy}
          onClick={complete}
        >
          {props.busy ? 'Saving…' : 'Complete sale'}
        </button>
      </div>
    </Modal>
  );
}
