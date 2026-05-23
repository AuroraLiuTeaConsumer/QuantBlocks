"use client";

import { useEffect, useRef, useState } from "react";
import { StrategyGraphSchema } from "@/lib/strategy/graphTypes";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";

type AiPromptPanelProps = {
  open: boolean;
  onClose: () => void;
  onDraft: (graph: StrategyGraph) => void;
  onError: (message: string) => void;
};

const EXAMPLES = [
  "RSI below 30 go long, above 70 close",
  "Buy on volume spike, sell after 2% gain",
  "Short if RSI > 70 with 1% stop loss",
];

export function AiPromptPanel({ open, onClose, onDraft, onError }: AiPromptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && taRef.current) taRef.current.focus();
  }, [open]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Enter a strategy description.");
      return;
    }

    setError(null);
    setValidationErrors([]);
    setNotes(null);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/translateStrategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data.error ?? `Request failed (${res.status})`;
        setError(message);
        onError(message);
        return;
      }

      const { nodes, edges } = data;
      if (nodes == null || edges == null) {
        const message = "Invalid response: missing nodes or edges";
        setError(message);
        onError(message);
        return;
      }

      const parsed = StrategyGraphSchema.safeParse({ nodes, edges });
      if (!parsed.success) {
        const messages = parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        );
        setValidationErrors(messages);
        const fullMessage = messages.join("; ");
        setError("Graph validation failed");
        onError(fullMessage);
        return;
      }

      if (typeof data.notes === "string" && data.notes) setNotes(data.notes);
      onDraft(parsed.data);
      // Keep prompt so user can re-tune; parent closes the panel.
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network or unexpected error";
      setError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="absolute right-3 top-2.5 z-[200] w-[308px] animate-fade-in rounded-xl border border-line bg-surface shadow-float">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="flex text-accent">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            <path d="M19.5 14l.75 2.25L22.5 17l-2.25.75L19.5 20l-.75-2.25L16.5 17l2.25-.75L19.5 14z" />
          </svg>
        </span>
        <span className="flex-1 text-[13px] font-bold text-ink-1">
          AI Strategy Builder
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI panel"
          className="flex p-0.5 text-ink-3 hover:text-ink-2"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="p-3.5">
        <p className="mb-2 text-[11px] leading-snug text-ink-2">
          Describe your strategy in plain English — the AI will build the node graph for you.
        </p>
        <textarea
          ref={taRef}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setError(null);
            setValidationErrors([]);
            setNotes(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
          placeholder="e.g. RSI below 30 go long, above 70 close"
          rows={4}
          disabled={loading}
          className="w-full resize-none rounded-md border-[1.5px] border-line-strong bg-surface-alt px-2.5 py-2 text-xs leading-snug text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
        />
        <div className="mb-2.5 mt-1 text-[10px] text-ink-3">⌘↵ to generate</div>

        {/* Errors */}
        {error && (
          <div className="mb-2.5 rounded-md border border-loss/30 bg-loss-bg p-2 text-[11px] text-loss">
            {error}
            {validationErrors.length > 0 && (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px]">
                {validationErrors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Notes after success */}
        {notes && !error && (
          <div className="mb-2.5 rounded-md border border-line bg-surface-alt p-2 text-[11px] text-ink-2">
            <span className="font-semibold text-ink-1">Notes:</span>{" "}
            <span className="whitespace-pre-wrap">{notes}</span>
          </div>
        )}

        {/* Action */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Generating…
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
              </svg>
              Generate
            </>
          )}
        </button>

        {/* Examples */}
        <div className="mt-3 rounded-md bg-surface-alt p-2.5 text-[10px] leading-relaxed text-ink-3">
          <div className="mb-1 font-semibold text-ink-2">Try:</div>
          <div className="flex flex-col gap-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="text-left text-[10px] text-ink-2 transition-colors hover:text-accent"
              >
                &ldquo;{ex}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
