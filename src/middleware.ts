import { NextRequest, NextResponse } from "next/server";

/**
 * MVP request guard: same-origin enforcement, API key auth for internal routes,
 * and in-memory fixed-window rate limiting.
 *
 * KNOWN LIMITATIONS (acceptable for a single-instance development server):
 *
 * 1. Rate-limit state is a module-level Map on this worker. In environments
 *    that spin up multiple workers (Vercel Edge, clustered Node) each worker
 *    tracks its own counters — there is no cross-process enforcement.
 *    Replace _rlStore with Redis / Upstash when deploying beyond a single server.
 *
 * 2. Authentication is a single shared API key (QUANTBLOCKS_API_KEY). This is
 *    sufficient for a solo/small-team internal tool but does not support
 *    per-user identity or audit trails. Add NextAuth + a User Prisma model
 *    (using the raw-SQL migration protocol) before exposing this to multiple users.
 *
 * 3. The in-memory Map grows until the worker restarts. At typical single-user
 *    traffic this is negligible; add TTL eviction for long-running servers.
 */

// ── In-memory rate-limit store ───────────────────────────────────────────────
type RLEntry = { count: number; windowStart: number };
const _rlStore = new Map<string, RLEntry>();

// ── Route policy types ───────────────────────────────────────────────────────
interface Policy {
  /** Returns true if this policy applies to the given pathname. */
  test: (pathname: string) => boolean;
  /** Stable bucket label — avoids per-session-ID Map explosion. */
  category: string;
  /** Max requests from one IP within windowMs. */
  limit: number;
  windowMs: number;
  /** When true the request must carry a valid x-api-key header. */
  requireApiKey?: boolean;
}

// ── Policies — evaluated in order; FIRST match wins ─────────────────────────
const POLICIES: Policy[] = [
  // ── Internal / admin routes — server-to-server only ─────────────────────
  // These do not exist yet but are classified now so adding them later
  // automatically gets the correct enforcement.
  {
    test: (p) => p.startsWith("/api/internal/") || p.startsWith("/api/admin/"),
    category: "internal",
    limit: 60,
    windowMs: 60_000,
    requireApiKey: true,
  },

  // ── Market data ingest — long-running trigger; very tight limit ──────────
  {
    test: (p) => p === "/api/market-data/ingest",
    category: "ingest",
    limit: 2,
    windowMs: 60_000,
    requireApiKey: true,
  },

  // ── AI strategy translation — expensive LLM call ────────────────────────
  {
    test: (p) => p.startsWith("/api/ai/"),
    category: "ai",
    limit: 10,
    windowMs: 60_000,
  },

  // ── Backtest: trigger + poll + export ────────────────────────────────────
  {
    test: (p) =>
      p.startsWith("/api/backtests/") ||
      (p.startsWith("/api/strategies/") && p.includes("/backtests")),
    category: "backtests",
    limit: 20,
    windowMs: 60_000,
  },

  // ── Paper trading: control actions (start / stop / reset) ────────────────
  // Checked BEFORE the poll policy so /stop and /reset are not mis-classified.
  {
    test: (p) =>
      (p.startsWith("/api/strategies/") && p.endsWith("/paper/start")) ||
      /^\/api\/paper\/[^/]+\/(stop|reset)$/.test(p),
    category: "paper-control",
    limit: 20,
    windowMs: 60_000,
  },

  // ── Paper trading: session poll — client fires every ~1 s ────────────────
  // Match exactly GET /api/paper/:sessionId (no trailing segment).
  {
    test: (p) => /^\/api\/paper\/[^/]+$/.test(p),
    category: "paper-poll",
    limit: 120,
    windowMs: 60_000,
  },

  // ── Market data: candle queries ───────────────────────────────────────────
  {
    test: (p) => p.startsWith("/api/market-data/candles"),
    category: "market-candles",
    limit: 60,
    windowMs: 60_000,
  },

  // ── Default for all other /api/ routes ───────────────────────────────────
  {
    test: (p) => p.startsWith("/api/"),
    category: "default",
    limit: 60,
    windowMs: 60_000,
  },
];

// ── Environment ──────────────────────────────────────────────────────────────
const CONFIGURED_KEY = process.env.QUANTBLOCKS_API_KEY;
const IS_PROD = process.env.NODE_ENV === "production";

// Log once at worker startup — avoids per-request noise.
if (!CONFIGURED_KEY) {
  if (IS_PROD) {
    console.error(
      "[middleware] QUANTBLOCKS_API_KEY is not set. " +
        "Internal and admin routes will return 401 in production.",
    );
  } else {
    console.warn(
      "[middleware] QUANTBLOCKS_API_KEY is not set. " +
        "Internal routes are unprotected — set the variable before deploying.",
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

/**
 * Returns false only when the request carries a cross-origin Origin header.
 * Requests without an Origin (server components, CLI tools, curl) are allowed —
 * they are server-to-server calls that do not carry cross-origin risk.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isValidApiKey(req: NextRequest): boolean {
  if (!CONFIGURED_KEY) {
    // No key configured: fail closed in production, warn-and-allow in development.
    return !IS_PROD;
  }
  return req.headers.get("x-api-key") === CONFIGURED_KEY;
}

/** Fixed-window counter. Returns true when the request is within the rate limit. */
function withinRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = _rlStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    _rlStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ── Middleware entry point ────────────────────────────────────────────────────

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const policy = POLICIES.find((p) => p.test(pathname));
  if (!policy) return NextResponse.next();

  // 1. API key — required for internal / admin / ingest routes
  if (policy.requireApiKey && !isValidApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Same-origin — block cross-origin requests to frontend API routes
  if (!policy.requireApiKey && !isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Rate limiting — bucket is IP + category (not full path) to prevent
  //    per-session-ID Map growth and to apply limits per route class, not per URL.
  const ip = getClientIp(req);
  if (!withinRateLimit(`${ip}:${policy.category}`, policy.limit, policy.windowMs)) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(policy.windowMs / 1000)) },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
