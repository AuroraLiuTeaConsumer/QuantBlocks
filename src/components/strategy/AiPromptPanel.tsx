"use client";

import { useState } from "react";
import { StrategyGraphSchema } from "@/lib/strategy/graphTypes";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";

type AiPromptPanelProps = {
  onDraft: (graph: StrategyGraph) => void;
  onError: (message: string) => void;
};

export function AiPromptPanel({ onDraft, onError }: AiPromptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string | null>(null);

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

      const nodes = data.nodes;
      const edges = data.edges;

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

      setError(null);
      setValidationErrors([]);
      if (typeof data.notes === "string" && data.notes) {
        setNotes(data.notes);
      }
      onDraft(parsed.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Network or unexpected error";
      setError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-r border-gray-800 bg-gray-900/50 p-4 w-[320px] shrink-0">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        AI Strategy Builder
      </h2>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. RSI below 30 go long, above 70 close"
        rows={4}
        className="mb-3 w-full resize-y rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        disabled={loading}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="mb-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate Strategy"}
      </button>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
          {validationErrors.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
              {validationErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notes && !error && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/80 p-3 text-xs text-gray-400">
          <span className="font-medium text-gray-500">Notes</span>
          <p className="mt-1 whitespace-pre-wrap">{notes}</p>
        </div>
      )}
    </div>
  );
}
