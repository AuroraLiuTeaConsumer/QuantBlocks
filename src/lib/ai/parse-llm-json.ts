/**
 * Robustly extract a single JSON object from raw LLM text output.
 *
 * Models are instructed to return raw JSON, but in practice they sometimes:
 *   - wrap the JSON in a markdown code fence (json or plain),
 *   - prepend a short preamble ("Here is the JSON:"),
 *   - append trailing prose after the JSON,
 *   - emit JSON whose string VALUES contain backticks or braces.
 *
 * The previous implementation used a pair of line-anchored fence-stripping
 * regexes with the multiline flag. They failed on every one of those cases -
 * most importantly they left any preamble line in place, so JSON.parse threw
 * and the caller reported "Model returned non-JSON output."
 *
 * This parser tries three strategies in order of increasing tolerance and
 * returns the first plain object it can parse, or null if none succeeds.
 */
export function parseLLMJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== "string") return null;

  const direct = text.trim();
  if (!direct) return null;

  // 1. Fast path: the output is already clean JSON.
  const asObject = tryParseObject(direct);
  if (asObject) return asObject;

  // 2. Pull the contents out of the first markdown code fence, if any.
  const fence = direct.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    const fromFence = tryParseObject(fence[1].trim());
    if (fromFence) return fromFence;
  }

  // 3. Last resort: scan for the first balanced {...} object, respecting
  //    string literals and escapes so braces inside values don't fool us.
  const balanced = extractBalancedObject(direct);
  if (balanced) return tryParseObject(balanced);

  return null;
}

function tryParseObject(candidate: string): Record<string, unknown> | null {
  try {
    const val = JSON.parse(candidate);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
