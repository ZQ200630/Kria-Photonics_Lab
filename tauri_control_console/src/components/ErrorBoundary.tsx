import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  title: string;
  resetLabel?: string;
  resetKey?: unknown;
  onReset?: () => void;
};

type State = {
  error: Error | null;
};

export function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function ErrorBoundaryFallback({
  title,
  error,
  resetLabel = "Back",
  onReset,
}: {
  title: string;
  error: unknown;
  resetLabel?: string;
  onReset?: () => void;
}) {
  return (
    <section className="panel ui-error-boundary" role="alert">
      <div>
        <h2>{title}</h2>
        <p>{messageFromUnknownError(error)}</p>
      </div>
      {onReset ? (
        <button type="button" className="command compact" onClick={onReset}>
          {resetLabel}
        </button>
      ) : null}
    </section>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.title, error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorBoundaryFallback
          title={this.props.title}
          error={this.state.error}
          resetLabel={this.props.resetLabel}
          onReset={this.props.onReset}
        />
      );
    }
    return this.props.children;
  }
}
