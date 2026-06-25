---
name: llm-json-parsing
description: "non-JSON output" errors have TWO causes — fence/preamble formatting (parser) AND output-token truncation (max_tokens). Check both.
metadata:
  type: project
---

AI routes parse raw LLM text into a JSON object. The shared parser is
`src/lib/ai/parseLLMJsonObject` in `src/lib/ai/parse-llm-json.ts`. Used by:
- `src/app/api/ai/builder/message/route.ts`
- `src/app/api/ai/translateStrategy/route.ts`

**Why:** Both routes previously had identical local `tryParseJson` helpers using
line-anchored fence-stripping regexes (`/^```(?:json)?\s*/m` + `/\s*```\s*$/m`).
With the multiline flag those `^`/`$` anchors match any line, so a model preamble
("Here is the JSON:") was left in place and `JSON.parse` threw -> the user saw
"Model returned non-JSON output. Please try again." This was the root cause of the
AI builder generate failure. The replacement tries: (1) direct parse, (2) first
markdown fence body, (3) first balanced `{...}` object scanned with string/escape
awareness so braces/backticks inside values don't corrupt extraction.

**How to apply:** Any new route that parses LLM JSON should import and use
`parseLLMJsonObject` rather than re-rolling fence stripping. Note the gotcha that
broke the first attempt: a regex literal like `\s*/m` written inside a JSDoc block
comment contains `*/`, which terminates the comment early and causes a cascade of
TS1127/TS1161 syntax errors. Avoid literal regex source in block comments.

**Second, independent cause — output truncation (found 2026-06-25).** The same
"Model returned non-JSON output" error also fires when the response is cut off
mid-JSON. The builder's final turn forces a long prose strategy summary PLUS a
full `draftUpdate` (entry/exit/risk conditions) in one envelope. With
`max_tokens` too low (was 1024) the JSON is truncated, `stop_reason ===
"max_tokens"`, the balanced-brace scan finds no closing brace, and the generic
error returns. This is why clarifying turns (small JSON) work but the first
strategy-generating turn fails. The parser fix could not address this.
Fix applied: `message/route.ts` raised `max_tokens` to 4096 AND now checks
`response.stop_reason === "max_tokens"`, returning a distinct "too long / cut
off" error so truncation is not mistaken for a formatting problem.
**How to apply:** when this error recurs, check `stop_reason` FIRST; size each
route's `max_tokens` to the largest payload it must emit (translateStrategy uses
its own 2048 budget).
Related: [[ai-builder-status-roundtrip]], [[draft-graph-roundtrip-lossy]].
