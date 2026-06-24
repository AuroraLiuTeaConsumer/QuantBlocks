import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { BUILDER_SYSTEM_PROMPT } from "@/lib/ai/builder-prompt";
import { EMPTY_DRAFT } from "@/lib/ai/ai-builder-state";
import type {
  BuilderMessageRequest,
  BuilderMessageResponse,
  AIBuilderMessage,
} from "@/types/ai-builder";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

/**
 * POST /api/ai/builder/message
 *
 * Stateless conversational endpoint for the AI Strategy Builder.
 * Receives the full conversation history + current draft on every call,
 * returns the next assistant message + a partial draft update.
 *
 * Input:  { messages: AIBuilderMessage[], currentDraft: StrategyDraft, canvasContext?: unknown }
 * Output: BuilderMessageResponse
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { messages, currentDraft, canvasContext } = body as Partial<BuilderMessageRequest>;

  const MAX_MESSAGES = 50;
  const MAX_CONTENT_LENGTH = 10_000;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages (non-empty array) is required" },
      { status: 400 }
    );
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `Conversation too long (max ${MAX_MESSAGES} messages)` },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 503 }
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the Anthropic messages array from the conversation history.
  // The welcome message is never included in the messages sent from the client,
  // so the first message here is always role: "user". ✓
  // Validate role strictly to prevent injecting a system role into the Anthropic API.
  const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages as Array<unknown>) {
    const msg = m as Partial<AIBuilderMessage>;
    if (msg.role !== "user" && msg.role !== "assistant") {
      return NextResponse.json({ error: "Invalid message role" }, { status: 400 });
    }
    if (typeof msg.content !== "string") {
      return NextResponse.json({ error: "Message content must be a string" }, { status: 400 });
    }
    claudeMessages.push({ role: msg.role, content: msg.content.slice(0, MAX_CONTENT_LENGTH) });
  }

  // Inject current draft + optional canvas summary as a second system block.
  // The canvas summary is compact (node type counts, not full positions) to save tokens.
  let draftContext = `Current strategy draft:\n${JSON.stringify(currentDraft ?? EMPTY_DRAFT, null, 2)}`;
  if (canvasContext && typeof canvasContext === "object") {
    const ctx = canvasContext as { nodes?: unknown[]; edges?: unknown[] };
    if (Array.isArray(ctx.nodes) && ctx.nodes.length > 0) {
      // Whitelist against known node types so user-controlled strings can't
      // inject arbitrary text into the system prompt via a crafted graph.
      const KNOWN_NODE_TYPES = new Set([
        "rsi", "indicator", "price", "volume", "compare", "cross",
        "and", "or", "not", "open_position", "close_position", "set_risk",
      ]);
      const typeCounts: Record<string, number> = {};
      for (const n of ctx.nodes as Array<{ type?: string }>) {
        const t = (typeof n.type === "string" && KNOWN_NODE_TYPES.has(n.type)) ? n.type : "unknown";
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      }
      const summary = Object.entries(typeCounts)
        .map(([t, c]) => `${c}× ${t}`)
        .join(", ");
      draftContext += `\n\nExisting canvas (${ctx.nodes.length} nodes): ${summary}.`;
    }
  }

  let raw: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: BUILDER_SYSTEM_PROMPT,
          // Cache the large static system prompt across requests
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: draftContext,
        },
      ],
      messages: claudeMessages,
    });

    raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Anthropic API error";
    return NextResponse.json({ error: `AI request failed: ${msg}` }, { status: 500 });
  }

  const parsed = tryParseJson(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "Model returned non-JSON output. Please try again." },
      { status: 500 }
    );
  }

  const responseBody: BuilderMessageResponse = {
    message: typeof parsed.message === "string" ? parsed.message : "I couldn't process that. Could you rephrase?",
    quickReplies: Array.isArray(parsed.quickReplies) ? parsed.quickReplies : undefined,
    draftUpdate: parsed.draftUpdate && typeof parsed.draftUpdate === "object" ? parsed.draftUpdate : {},
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    nextAction: isValidNextAction(parsed.nextAction) ? parsed.nextAction : "ask_clarification",
    conversationStatus: isValidConversationStatus(parsed.conversationStatus)
      ? parsed.conversationStatus
      : "collecting_requirements",
  };

  return NextResponse.json(responseBody);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryParseJson(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    const val = JSON.parse(stripped);
    if (val && typeof val === "object" && !Array.isArray(val)) return val;
    return null;
  } catch {
    return null;
  }
}

// Phase A: the system prompt only emits these two values.
// "update_draft" and "confirm_graph" are reserved for future phases.
function isValidNextAction(v: unknown): v is BuilderMessageResponse["nextAction"] {
  return v === "ask_clarification" || v === "ready_to_generate";
}

// Phase A: the system prompt only emits these two values.
// "graph_generated", "revising", "error", "idle" are set client-side or reserved for future phases.
function isValidConversationStatus(v: unknown): v is BuilderMessageResponse["conversationStatus"] {
  return v === "collecting_requirements" || v === "ready_to_generate";
}
