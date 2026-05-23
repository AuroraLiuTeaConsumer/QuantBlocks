"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Strategy = {
  id: string;
  name: string;
  description: string | null;
  instrument: string;
  timeframe: string;
  nodes: unknown[];
  edges: unknown[];
  createdAt: string;
  updatedAt: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent shadow-[0_2px_8px_rgba(41,98,255,0.35)]">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="9" width="3.5" height="6" rx="1" fill="white" opacity=".55" />
        <rect x="6.25" y="5.5" width="3.5" height="9.5" rx="1" fill="white" opacity=".78" />
        <rect x="11.5" y="1" width="3.5" height="14" rx="1" fill="white" />
      </svg>
    </div>
  );
}

function StrategyIcon() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-accent-border bg-accent-bg">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="1" y="11" width="3.5" height="8" rx="1" fill="var(--accent)" opacity=".35" />
        <rect x="6.5" y="7" width="3.5" height="12" rx="1" fill="var(--accent)" opacity=".6" />
        <rect x="12" y="2" width="3.5" height="17" rx="1" fill="var(--accent)" />
      </svg>
    </div>
  );
}

export default function StrategiesPage() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Initial fetch
  useEffect(() => {
    let cancel = false;
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data) => {
        if (!cancel) setStrategies(data);
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const submit = async () => {
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          nodes: [],
          edges: [],
          timeframe: "1h",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create");
        setSubmitting(false);
        return;
      }
      router.push(`/strategies/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] py-12">
      <div className="mx-auto w-full max-w-[660px] px-6">
        {/* Brand */}
        <div className="mb-10 flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-extrabold tracking-tight text-ink-1">
            QuantBlocks
          </span>
        </div>

        {/* Heading */}
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight text-ink-1">
              Strategies
            </h1>
            <p className="mt-0.5 text-xs text-ink-2">
              {strategies == null
                ? "Loading…"
                : `${strategies.length} ${strategies.length === 1 ? "strategy" : "strategies"} · sorted by recent`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] transition hover:brightness-95"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New Strategy
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="mb-2.5 animate-fade-in rounded-[11px] border-[1.5px] border-accent-border bg-surface p-4 shadow-[0_4px_16px_rgba(41,98,255,0.08)]">
            <div className="mb-2.5 text-xs font-semibold text-ink-1">
              New Strategy
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="Strategy name…"
                disabled={submitting}
                className="flex-1 rounded-md border-[1.5px] border-line-strong bg-surface-alt px-2.5 py-1.5 text-xs text-ink-1 outline-none transition-colors focus:border-accent"
              />
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!newName.trim() || submitting}
                className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-2.5 rounded-md border border-loss/30 bg-loss-bg px-3 py-2 text-xs text-loss">
            {error}
          </div>
        )}

        {/* Strategy list */}
        {strategies != null && strategies.length === 0 && (
          <div className="rounded-[11px] border border-line bg-surface px-6 py-10 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[9px] border border-accent-border bg-accent-bg text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-ink-1">No strategies yet</div>
            <div className="mt-1 text-xs text-ink-2">
              Click <span className="font-semibold">+ New Strategy</span> to create your first one.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {strategies?.map((s) => (
            <Link
              key={s.id}
              href={`/strategies/${s.id}`}
              className="group flex items-center gap-3.5 rounded-[11px] border-[1.5px] border-line bg-surface px-4 py-3.5 shadow-card transition-all hover:border-accent-border hover:shadow-card-hover"
            >
              <StrategyIcon />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink-1">{s.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-2">
                  <span className="font-mono font-medium">{s.instrument}</span>
                  <span className="text-ink-3">·</span>
                  <span>{s.timeframe}</span>
                  <span className="text-ink-3">·</span>
                  <span>
                    {(s.nodes as unknown[]).length} node
                    {(s.nodes as unknown[]).length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-ink-3">{timeAgo(s.updatedAt)}</div>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 2l3.5 3.5L4 9" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
