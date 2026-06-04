/**
 * Quick smoke test for the AI strategy translator.
 * Run: npx tsx test-ai-stub.mts
 */
import Anthropic from "@anthropic-ai/sdk";
import { validateGraph } from "./src/lib/strategy/validator.js";
import { SYSTEM_PROMPT } from "./src/lib/ai/strategy-prompt.js";

const MODEL = "claude-sonnet-4-6";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callClaude(userContent: string): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try { return JSON.parse(stripped); } catch { return null; }
}

const PROMPTS = [
  "Go long on BTC when RSI drops below 30, and close the position when RSI rises above 70. Use a 2% stop loss and 5% take profit.",
  "Open a short when price crosses below a 50000 level, close when price crosses back above it.",
];

for (const prompt of PROMPTS) {
  console.log("─".repeat(70));
  console.log("PROMPT:", prompt);
  console.log("Calling Claude...");

  const raw = await callClaude(`Strategy description: ${prompt}\nPreferred timeframe: 1h`);
  const parsed = tryParseJson(raw);

  if (!parsed) {
    console.error("❌ Non-JSON response:\n", raw);
    continue;
  }

  console.log("Strategy:", parsed.strategyName, "| TF:", parsed.timeframe);
  console.log("Nodes:", (parsed.nodes as unknown[]).length, "| Edges:", (parsed.edges as unknown[]).length);
  console.log("Notes:", parsed.notes);

  const validation = validateGraph({ nodes: parsed.nodes, edges: parsed.edges });
  if (validation.valid) {
    console.log("✅ Graph is VALID");
  } else {
    console.log("❌ Graph is INVALID:");
    validation.errors.forEach((e) => console.log("  -", e.message));
  }
  console.log();
}
