import { Money } from '../../domain/valueObjects/Money';

/** Peso text input that reports integer centavos (null when invalid/empty). */
export function MoneyInput(props: {
  label: string;
  value: string;
  onChange: (raw: string, centavos: number | null) => void;
  autoFocus?: boolean;
  testId?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        inputMode="decimal"
        autoFocus={props.autoFocus}
        data-testid={props.testId}
        value={props.value}
        placeholder="0.00"
        onChange={(e) => {
          const raw = e.target.value;
          props.onChange(raw, Money.parsePesos(raw)?.centavos ?? null);
        }}
      />
    </label>
  );
}
