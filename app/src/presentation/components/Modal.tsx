import { useEffect, type ReactNode } from 'react';

export function Modal(props: {
  title: string;
  onClose?: (() => void) | undefined;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  const { onClose } = props;
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className={`modal ${props.wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} data-testid={props.testId}>
        <header className="modal__header">
          <h2>{props.title}</h2>
          {onClose && (
            <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>
        <div className="modal__body">{props.children}</div>
        {props.footer && <footer className="modal__footer">{props.footer}</footer>}
      </div>
    </div>
  );
}
