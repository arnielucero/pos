export function PinPad(props: { value: string; onChange: (v: string) => void; length?: number; disabled?: boolean }) {
  const length = props.length ?? 6;
  const press = (d: string): void => {
    if (props.value.length < length) props.onChange(props.value + d);
  };
  return (
    <div className="pinpad">
      <div className="pinpad__dots" aria-label="PIN entered">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={i < props.value.length ? 'dot dot--on' : 'dot'} />
        ))}
      </div>
      <input
        className="visually-hidden-input"
        aria-label="Manager PIN"
        data-testid="pin-input"
        inputMode="numeric"
        type="password"
        autoComplete="off"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          props.onChange(e.target.value.replace(/\D/g, '').slice(0, length));
        }}
      />
      <div className="pinpad__keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
          <button
            key={k}
            type="button"
            className="btn pinpad__key"
            disabled={props.disabled}
            onClick={() => {
              if (k === 'C') props.onChange('');
              else if (k === '⌫') props.onChange(props.value.slice(0, -1));
              else press(k);
            }}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
