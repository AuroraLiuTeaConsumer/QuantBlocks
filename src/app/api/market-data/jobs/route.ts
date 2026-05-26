/**
 * GET /api/market-data/jobs
 *
 * Returns recent IngestionJob records from Prisma for display in the
 * /market-data dashboard. Ordered newest-first.
 *
 * Query params:
 *   limit?   — number of records to return (default 50, max 200)
 *   status?  — filter by status: running | completed | failed | pending
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const status = searchParams.get("status") ?? undefined;

  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) : 50),
    200,
  );

  if (Number.isNaN(limit)) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }

  const jobs = await prisma.ingestionJob.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(jobs);
}
