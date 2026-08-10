import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './RenderErrorBoundary.module.css';
import { buildRenderErrorReport, reportRenderError } from './renderErrorReport.js';

interface Props {
  children: ReactNode;
  label?: string;
  resetKey?: string | number;
  fallback?: (opts: { reset: () => void; error: Error | null }) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export default class RenderErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  /**
   * Structured and redacted. The error object, its message, its stack, and React's
   * component stack are NOT logged — see renderErrorReport.ts for why each of those
   * carries module paths or the owner's own data. The crash is still visible: label,
   * error class, and tree depth.
   *
   * Product delivery uses this same content-free object; the reporter never
   * receives the error, its message, or either stack.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRenderError(
      buildRenderErrorReport(this.props.label ?? 'Render', error, info.componentStack),
    );
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false, error: null });
      if (this.props.fallback) return this.props.fallback({ reset, error: this.state.error });
      const detail = DEV ? this.state.error?.message : null;
      return (
        <div className={styles.wrapper} role="status">
          <p className={styles.title}>Something went wrong.</p>
          <p className={styles.hint}>This section failed to render.</p>
          {detail ? <p className={styles.hint}>{detail}</p> : null}
          <button onClick={reset} className={styles.action}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
