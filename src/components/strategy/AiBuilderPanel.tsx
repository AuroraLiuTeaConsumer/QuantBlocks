"use client";

import { useEffect, useRef, useState } from "react";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import type {
  AIBuilderConversation,
  AIBuilderMessage,
  AIBuilderNextAction,
} from "@/types/ai-builder";
import {
  EMPTY_DRAFT,
  mergeDraftUpdate,
  normalizeDraft,
  isDraftReady,
  requiredMissingCount,
} from "@/lib/ai/ai-builder-state";
import { graphToStrategyDraft } from "@/lib/ai/graph-to-draft";
import { AiDraftCard } from "./AiDraftCard";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AiBuilderPanelProps = {
  open: boolean;
  onClose: () => void;
  onDraft: (graph: StrategyGraph) => void;
  onError: (message: string) => void;
  canvasGraph?: StrategyGraph;
};

// ---------------------------------------------------------------------------
// Welcome message — static UI element, never sent to the LLM
// ---------------------------------------------------------------------------

const WELCOME: AIBuilderMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm your strategy-building assistant.\n\nTell me what trading idea you have in mind — even a rough one — and I'll guide you through defining it step by step.",
  timestamp: 0,
  quickReplies: ["BTC breakout strategy", "RSI mean reversion on ETH", "I'll describe it myself"],
};

// ---------------------------------------------------------------------------
// Initial conversation state
// ---------------------------------------------------------------------------

function createInitialConversation(): AIBuilderConversation {
  return {
    id: crypto.randomUUID(),
    status: "idle",
    intent: "unknown",
    messages: [],
    draft: { ...EMPTY_DRAFT },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AiBuilderPanel({ open, onClose, onDraft, onError, canvasGraph }: AiBuilderPanelProps) {
  const [conversation, setConversation] = useState<AIBuilderConversation>(createInitialConversation);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [nextAction, setNextAction] = useState<AIBuilderNextAction>("ask_clarification");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Tracks whether we have already seeded the draft from canvasGraph this session.
  // Reset to false each time the panel closes so re-opening a new session can import again.
  const sessionInitialized = useRef(false);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages.length, isLoading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Revision-mode init: when the panel opens with a non-empty canvas, seed the
  // draft from the existing graph and skip straight to revision mode.
  useEffect(() => {
    if (!open) {
      sessionInitialized.current = false; // reset so next open can re-import
      return;
    }
    if (sessionInitialized.current) return;
    sessionInitialized.current = true;

    if (!canvasGraph || canvasGraph.nodes.length === 0) return;

    const importedDraft = graphToStrategyDraft(canvasGraph);
    const revisionWelcome: AIBuilderMessage = {
      id: "revision-welcome",
      role: "assistant",
      content:
        "I've loaded your current strategy from the canvas.\n\nWhat would you like to change? For example:\n• Adjust stop loss or take profit\n• Switch to a different indicator\n• Add or remove a filter\n• Explain what this strategy does",
      timestamp: Date.now(),
      quickReplies: ["Adjust stop loss", "Change entry indicator", "Add volume filter", "Explain my strategy"],
    };

    setConversation((prev) => ({
      ...prev,
      status: "revising",
      draft: importedDraft,
      messages: [revisionWelcome],
    }));
    setNextAction("ask_clarification");
  }, [open, canvasGraph]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;

    const userMessage: AIBuilderMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    // Capture current state synchronously before any async gap
    const messagesWithUser = [...conversation.messages, userMessage];
    const currentDraft = conversation.draft;

    setConversation((prev) => ({
      ...prev,
      status: prev.status === "idle" ? "collecting_requirements" : prev.status,
      messages: messagesWithUser,
    }));
    setInput("");
    setApiError(null);
    setIsLoading(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      const res = await fetch("/api/ai/builder/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesWithUser, currentDraft, canvasContext: canvasGraph }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error ?? `Request failed (${res.status})`;
        setApiError(msg);
        onError(msg);
        return;
      }

      const {
        message,
        quickReplies,
        draftUpdate,
        missingFields,
        nextAction: newNextAction,
        conversationStatus,
      } = data;

      const assistantMessage: AIBuilderMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: typeof message === "string" ? message : "Something went wrong — please try again.",
        timestamp: Date.now(),
        quickReplies: Array.isArray(quickReplies) ? quickReplies : undefined,
      };

      // Merge LLM's draft update and normalize to guard against malformed arrays
      const updatedDraft = normalizeDraft(mergeDraftUpdate(currentDraft, {
        ...draftUpdate,
        missingFields: Array.isArray(missingFields) ? missingFields : currentDraft.missingFields,
      }));

      setNextAction(newNextAction ?? "ask_clarification");
      setConversation((prev) => ({
        ...prev,
        // Preserve "revising" — the server validator never emits it, so the
        // server value would always clobber the client's revision state.
        status: prev.status === "revising"
          ? "revising"
          : (conversationStatus ?? "collecting_requirements"),
        messages: [...prev.messages, assistantMessage],
        draft: updatedDraft,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network or unexpected error";
      setApiError(msg);
      onError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  // LLM's nextAction is the primary signal; isDraftReady() is a safety guard before the API call.
  const canGenerate = nextAction === "ready_to_generate" && isDraftReady(conversation.draft);

  const handleGenerateGraph = async () => {
    if (!canGenerate || isGenerating) return;

    setApiError(null);
    setIsGenerating(true);

    try {
      const res = await fetch("/api/ai/builder/generate-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: conversation.draft }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error ?? `Generate failed (${res.status})`;
        const details: string[] = Array.isArray(data.details) ? data.details : [];
        setApiError(details.length ? `${msg}: ${details.join("; ")}` : msg);
        return;
      }

      const { graph } = data as { graph: unknown; warnings: string[] };
      if (!graph || typeof graph !== "object") {
        setApiError("Server returned an invalid graph.");
        return;
      }

      setConversation((prev) => ({ ...prev, status: "graph_generated" }));
      onDraft(graph as Parameters<typeof onDraft>[0]);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error during generation";
      setApiError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const missingCount = requiredMissingCount(conversation.draft.missingFields);

  return (
    <div
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-surface"
      style={{ display: open ? undefined : "none" }}
    >
      {/* Header */}
      <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-line px-3.5">
        <span className="text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            <path d="M19.5 14l.75 2.25L22.5 17l-2.25.75L19.5 20l-.75-2.25L16.5 17l2.25-.75L19.5 14z" />
          </svg>
        </span>
        <span className="flex-1 text-[13px] font-bold text-ink-1">AI Strategy Builder</span>

        {/* Draft status pill */}
        {conversation.status !== "idle" && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              canGenerate
                ? "bg-[var(--green-bg,#dcfce7)] text-[var(--green,#16a34a)]"
                : "bg-surface-alt text-ink-3"
            }`}
          >
            {canGenerate
              ? "Draft complete"
              : missingCount > 0
              ? `${missingCount} required left`
              : "Collecting…"}
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Builder"
          className="flex p-1 text-ink-3 hover:text-ink-2"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {/* Draft summary card — shown once the conversation is active or in revision mode */}
      {(conversation.status !== "idle") && (
        <AiDraftCard draft={conversation.draft} />
      )}

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {/* Static welcome message */}
        <MessageBubble
          message={WELCOME}
          onQuickReply={sendMessage}
          disabled={isLoading}
        />

        {/* Dynamic conversation */}
        {conversation.messages.map((msg, i) => {
          const isLastAssistant =
            msg.role === "assistant" &&
            i === conversation.messages.length - 1;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              onQuickReply={sendMessage}
              disabled={isLoading}
              showQuickReplies={isLastAssistant}
            />
          );
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="flex max-w-[85%] items-center gap-1.5 rounded-xl rounded-bl-sm border border-line bg-surface-alt px-3 py-2.5">
              <span
                className="block h-1.5 w-1.5 rounded-full bg-ink-3"
                style={{ animation: "bounce 1s ease-in-out infinite", animationDelay: "0ms" }}
              />
              <span
                className="block h-1.5 w-1.5 rounded-full bg-ink-3"
                style={{ animation: "bounce 1s ease-in-out infinite", animationDelay: "150ms" }}
              />
              <span
                className="block h-1.5 w-1.5 rounded-full bg-ink-3"
                style={{ animation: "bounce 1s ease-in-out infinite", animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}

        {/* API error */}
        {apiError && (
          <div className="rounded-md border border-loss/30 bg-loss-bg px-3 py-2 text-[11px] text-loss">
            {apiError}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Generate Graph button */}
      <div className="shrink-0 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={handleGenerateGraph}
          disabled={!canGenerate || isGenerating}
          title={canGenerate ? "Generate the strategy canvas graph" : "Complete the draft to enable"}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating ? (
            <>
              <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Building graph…
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
              </svg>
              Generate Graph
            </>
          )}
        </button>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-surface-alt px-3 py-2 focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe your strategy idea…"
            rows={1}
            disabled={isLoading}
            className="min-h-[20px] flex-1 resize-none bg-transparent text-xs leading-snug text-ink-1 outline-none placeholder:text-ink-3 disabled:opacity-50"
            style={{ maxHeight: 120 }}
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="mb-0.5 flex shrink-0 items-center justify-center rounded-md bg-accent p-1.5 text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22 11 13 2 9l20-7z" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-3">↵ send · Shift+↵ newline · Esc close</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

type MessageBubbleProps = {
  message: AIBuilderMessage;
  onQuickReply: (content: string) => void;
  disabled?: boolean;
  showQuickReplies?: boolean;
};

function MessageBubble({
  message,
  onQuickReply,
  disabled,
  showQuickReplies = true,
}: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-1.5`}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? "rounded-br-sm bg-accent text-white"
            : "rounded-bl-sm border border-line bg-surface-alt text-ink-1"
        }`}
      >
        <span className="whitespace-pre-wrap">{message.content}</span>
      </div>

      {/* Quick reply chips — only on the last assistant message */}
      {!isUser && showQuickReplies && message.quickReplies && message.quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => onQuickReply(reply)}
              disabled={disabled}
              className="rounded-full border border-accent/40 bg-accent-bg px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
            >
              {reply}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
