import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, info: ErrorInfo, reset: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
  paneId?: string;
  style?: React.CSSProperties;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      error,
      errorInfo,
    });

    // Log error with component stack for debugging
    console.error('[ErrorBoundary]', {
      paneId: this.props.paneId,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  resetErrors = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, paneId, style } = this.props;

    if (hasError && error) {
      // Use custom fallback if provided
      if (fallback) {
        if (typeof fallback === 'function') {
          return (
            <div className="error-boundary-fallback" style={style} data-pane-id={paneId}>
              {fallback(error, errorInfo!, this.resetErrors)}
            </div>
          );
        }
        return (
          <div className="error-boundary-fallback" style={style} data-pane-id={paneId}>
            {fallback}
          </div>
        );
      }

      // Default fallback UI
      return (
        <div className="error-boundary-fallback" style={style} data-pane-id={paneId}>
          <div className="error-boundary-content">
            <div className="error-boundary-icon">
              <AlertTriangle size={32} />
            </div>
            <h3 className="error-boundary-title">Something went wrong</h3>
            {paneId && (
              <p className="error-boundary-pane-id">Pane: {paneId}</p>
            )}
            <p className="error-boundary-message">
              {error.message || 'An unexpected error occurred'}
            </p>
            <button
              className="error-boundary-retry"
              onClick={this.resetErrors}
              type="button"
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="error-boundary-wrapper" style={style}>
        {children}
      </div>
    );
  }
}
