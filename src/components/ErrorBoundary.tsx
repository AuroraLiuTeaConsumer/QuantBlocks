"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  /** Short label shown in the fallback heading, e.g. "Canvas" or "Backtest". */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.label ? ` – ${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const title = this.props.label
      ? `${this.props.label} crashed`
      : "Something went wrong";

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-loss/40 bg-loss-bg">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--red)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5" />
            <circle cx="8" cy="11" r=".75" fill="var(--red)" stroke="none" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-1">{title}</div>
          <div className="mt-1 max-w-[300px] text-xs text-ink-3">
            {this.state.error.message || "An unexpected error occurred."}
          </div>
        </div>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
        >
          Retry
        </button>
      </div>
    );
  }
}
