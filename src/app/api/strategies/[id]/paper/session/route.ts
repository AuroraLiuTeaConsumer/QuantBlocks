import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";

/**
 * GET /api/strategies/:id/paper/session
 *
 * Returns the most recent running or stopped paper session for a strategy,
 * so the UI can auto-resume on page load without the user having to click Start.
 *
 * 200 — session snapshot
 * 404 — no active session (strategy never started, or was reset to idle)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await prisma.paperSession.findFirst({
    where: { strategyId: id, status: { in: ["running", "stopped"] } },
    orderBy: { updatedAt: "desc" },
  });

  if (!session) {
    return NextResponse.json(null, { status: 404 });
  }

  return NextResponse.json(toSnapshot(session as unknown as SessionRow));
}
