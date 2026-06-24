import { NextRequest, NextResponse } from "next/server";
import { normalizeDraft } from "@/lib/ai/ai-builder-state";
import { validateStrategyDraft } from "@/lib/ai/validate-draft";
import { draftToStrategyGraph } from "@/lib/ai/draft-to-graph";
import { validateGraph } from "@/lib/strategy/validator";

/**
 * POST /api/ai/builder/generate-graph
 *
 * Deterministic: no LLM call. Validates a StrategyDraft and converts it to a
 * StrategyGraph using draftToStrategyGraph().
 *
 * Input:  { draft: StrategyDraft }
 * Output: { graph: StrategyGraph, warnings: string[] }
 * Errors: 400 bad input, 422 invalid draft, 500 generated graph failed validation
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { draft: rawDraft } = body as { draft?: unknown };

  if (!rawDraft || typeof rawDraft !== "object") {
    return NextResponse.json({ error: "draft (object) is required" }, { status: 400 });
  }

  // Normalize to guard against missing array fields from the client
  const draft = normalizeDraft(rawDraft);

  // 1. Validate draft completeness
  const draftValidation = validateStrategyDraft(draft);
  if (!draftValidation.valid) {
    return NextResponse.json(
      { error: "Draft is incomplete", details: draftValidation.errors },
      { status: 422 }
    );
  }

  // 2. Convert draft → graph (deterministic, no LLM)
  const { graph, warnings } = draftToStrategyGraph(draft);

  // 3. Double-check the generated graph passes schema + structural validation
  const graphValidation = validateGraph(graph);
  if (!graphValidation.valid) {
    return NextResponse.json(
      {
        error: "Generated graph failed validation",
        details: graphValidation.errors.map((e) => e.message),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    graph,
    warnings: [...draftValidation.warnings, ...warnings],
  });
}
