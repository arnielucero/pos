import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { Logger } from '../../application/ports/Logger';

interface Props {
  readonly children: ReactNode;
  readonly logger?: Logger | undefined;
  readonly fallbackTitle?: string;
}

interface State {
  readonly failed: boolean;
}

/** Catches render errors and shows a friendly message (never a stack trace). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.logger?.error('UI crashed', { error: error.message, component: info.componentStack?.split('\n')[1]?.trim() });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-panel" role="alert">
        <h2>{this.props.fallbackTitle ?? 'This screen had a problem'}</h2>
        <p>Your sales are safe. Try again; if it keeps happening, restart the app.</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
