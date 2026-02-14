import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "running") {
    return NextResponse.json(
      { error: `Cannot stop session with status "${session.status}"` },
      { status: 400 },
    );
  }

  const updated = await prisma.paperSession.update({
    where: { id: sessionId },
    data: { status: "stopped" },
  });

  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
