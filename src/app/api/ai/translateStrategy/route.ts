import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { validateGraph } from "@/lib/strategy/validator";
import { SYSTEM_PROMPT } from "@/lib/ai/strategy-prompt";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

/**
 * POST /api/ai/translateStrategy
 *
 * Translates a natural-language strategy description into a validated node graph.
 *
 * Input:  { prompt: string, timeframe?: string }
 * Output: { strategyName, timeframe, nodes, edges, notes }
 * Errors: { error: string }  — 400 for bad input, 422 for unresolvable graph, 500 for API failure
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { prompt, timeframe } = body as Record<string, unknown>;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt (string) is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const client = new Anthropic({ apiKey });

  const userMessage =
    `Strategy description: ${prompt.trim()}` +
    (timeframe ? `\nPreferred timeframe: ${timeframe}` : "");

  // First attempt
  let raw: string;
  try {
    raw = await callClaude(client, userMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Anthropic API error";
    return NextResponse.json({ error: `AI request failed: ${msg}` }, { status: 500 });
  }
  let parsed = tryParseJson(raw);

  if (!parsed) {
    return NextResponse.json(
      { error: "Model returned non-JSON output. Please try again." },
      { status: 500 },
    );
  }

  let validation = validateGraph({ nodes: parsed.nodes, edges: parsed.edges });

  // One retry: feed the validation errors back so the model can self-correct
  if (!validation.valid) {
    const errorSummary = validation.errors.map((e) => `- ${e.message}`).join("\n");
    const retryMessage =
      `${userMessage}\n\n` +
      `Your previous attempt produced an invalid graph. Fix ALL of the following errors and return a corrected JSON:\n` +
      `${errorSummary}`;

    try {
      raw = await callClaude(client, retryMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Anthropic API error";
      return NextResponse.json({ error: `AI retry request failed: ${msg}` }, { status: 500 });
    }
    parsed = tryParseJson(raw);

    if (!parsed) {
      return NextResponse.json(
        { error: "Model returned non-JSON output on retry. Please try again." },
        { status: 500 },
      );
    }

    validation = validateGraph({ nodes: parsed.nodes, edges: parsed.edges });
  }

  if (!validation.valid) {
    const details = validation.errors.map((e) => e.message).join("; ");
    return NextResponse.json(
      {
        error: `Could not generate a valid strategy graph after retry. Validation errors: ${details}`,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    strategyName: parsed.strategyName ?? "AI Generated Strategy",
    timeframe: parsed.timeframe ?? timeframe ?? "1h",
    nodes: parsed.nodes,
    edges: parsed.edges,
    notes: parsed.notes ?? "",
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callClaude(client: Anthropic, userContent: string): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Cache the large static system prompt across requests
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function tryParseJson(text: string): Record<string, unknown> | null {
  // Strip markdown code fences if the model wrapped the JSON
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
