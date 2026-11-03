import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { logClient } from "../lib/log";

/** Route-level boundary: a render error shows a card instead of blanking the app. Top bar and tab bar sit outside. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logClient({ kind: "react", message: error.message || String(error), stack: error.stack ?? null, component: info.componentStack ?? null });
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="mx-auto w-full max-w-[640px] px-6 pb-[140px] pt-16">
        <div role="alert" className="card flex flex-col items-start gap-3 p-6">
          <h1 className="text-title">Something went wrong on this page.</h1>
          <p className="text-body text-l2">The rest of the app still works. The error was written to the log.</p>
          <code className="max-w-full whitespace-pre-wrap break-words rounded-[10px] bg-s2 px-2.5 py-1.5 text-[12px] text-white/75">{error.message || String(error)}</code>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-white" onClick={this.reset}>Try again</button>
            <Link to="/" className="btn-ghost" onClick={this.reset}>Back to Today</Link>
          </div>
        </div>
      </main>
    );
  }
}
