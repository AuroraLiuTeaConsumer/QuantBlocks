/**
 * /market-data — Data Coverage Dashboard
 *
 * Server component: queries TimescaleDB coverage and recent IngestionJob records
 * directly (no client-side fetch needed for the initial render).
 */

import Link from "next/link";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { prisma } from "@/lib/prisma";
import type {
  CandleCoverageSeries,
  FundingRateCoverageSeries,
  OpenInterestCoverageSeries,
  LiquidationCoverageSeries,
  LongShortRatioCoverageSeries,
} from "@/lib/market-data/storage/timescale.repo";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtN(n: number): string {
  return n.toLocaleString();
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    completed: "bg-green-500",
    running: "bg-blue-400 animate-pulse",
    failed: "bg-red-500",
    pending: "bg-gray-500",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full mr-2 ${colors[status] ?? "bg-gray-500"}`}
    />
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <span className="text-xs text-gray-500">{count} series</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-gray-800 px-4 py-6 text-center text-gray-500 text-sm">
      {message}
    </div>
  );
}

function CandleTable({ rows }: { rows: CandleCoverageSeries[] }) {
  if (rows.length === 0) {
    return <EmptyState message="No candle data ingested yet. Run: npm run ingest" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Exchange</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Timeframe</th>
            <th className="px-4 py-2 text-right text-gray-400 font-medium">Bars</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Oldest</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Newest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
            >
              <td className="px-4 py-2 text-gray-300 font-mono text-xs">{r.exchange}</td>
              <td className="px-4 py-2 text-white font-mono text-xs">{r.symbol}</td>
              <td className="px-4 py-2">
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono">
                  {r.timeframe}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-white font-mono">{fmtN(r.barCount)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.oldestBar)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.newestBar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FundingRateTable({ rows }: { rows: FundingRateCoverageSeries[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No funding rate data ingested yet. Run: npm run ingest -- --dataType funding_rate" />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Exchange</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
            <th className="px-4 py-2 text-right text-gray-400 font-medium">Events</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Oldest</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Newest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
            >
              <td className="px-4 py-2 text-gray-300 font-mono text-xs">{r.exchange}</td>
              <td className="px-4 py-2 text-white font-mono text-xs">{r.symbol}</td>
              <td className="px-4 py-2 text-right text-white font-mono">{fmtN(r.count)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.oldest)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpenInterestTable({ rows }: { rows: OpenInterestCoverageSeries[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No open interest data ingested yet. Run: npm run ingest -- --dataType open_interest" />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Exchange</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Timeframe</th>
            <th className="px-4 py-2 text-right text-gray-400 font-medium">Snapshots</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Oldest</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Newest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
            >
              <td className="px-4 py-2 text-gray-300 font-mono text-xs">{r.exchange}</td>
              <td className="px-4 py-2 text-white font-mono text-xs">{r.symbol}</td>
              <td className="px-4 py-2">
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono">
                  {r.timeframe}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-white font-mono">{fmtN(r.count)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.oldest)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiquidationTable({ rows }: { rows: LiquidationCoverageSeries[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No liquidation data ingested yet. Run: npm run ingest -- --dataType liquidation --symbol BTC" />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Timeframe</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Source</th>
            <th className="px-4 py-2 text-right text-gray-400 font-medium">Bars</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Oldest</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Newest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
            >
              <td className="px-4 py-2 text-white font-mono text-xs">{r.symbol}</td>
              <td className="px-4 py-2">
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono">
                  {r.timeframe}
                </span>
              </td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{r.source}</td>
              <td className="px-4 py-2 text-right text-white font-mono">{fmtN(r.count)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.oldest)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LongShortRatioTable({ rows }: { rows: LongShortRatioCoverageSeries[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No long/short ratio data ingested yet. Run: npm run ingest -- --dataType long_short --symbol BTC" />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Timeframe</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Source</th>
            <th className="px-4 py-2 text-right text-gray-400 font-medium">Rows</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Oldest</th>
            <th className="px-4 py-2 text-left text-gray-400 font-medium">Newest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
            >
              <td className="px-4 py-2 text-white font-mono text-xs">{r.symbol}</td>
              <td className="px-4 py-2">
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono">
                  {r.timeframe}
                </span>
              </td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{r.source}</td>
              <td className="px-4 py-2 text-right text-white font-mono">{fmtN(r.count)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.oldest)}</td>
              <td className="px-4 py-2 text-gray-400 font-mono text-xs">{fmt(r.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MarketDataPage() {
  // Fetch coverage and jobs concurrently
  const repo = getTimescaleRepo();
  const [candleCoverage, fundingCoverage, oiCoverage, liqCoverage, lsCoverage, recentJobs] =
    await Promise.all([
      repo.getCandleCoverage().catch(() => [] as CandleCoverageSeries[]),
      repo.getFundingRateCoverage().catch(() => [] as FundingRateCoverageSeries[]),
      repo.getOpenInterestCoverage().catch(() => [] as OpenInterestCoverageSeries[]),
      repo.getLiquidationCoverage().catch(() => [] as LiquidationCoverageSeries[]),
      repo.getLongShortRatioCoverage().catch(() => [] as LongShortRatioCoverageSeries[]),
      prisma.ingestionJob
        .findMany({ orderBy: { createdAt: "desc" }, take: 20 })
        .catch(() => []),
    ]);

  const totalRows =
    candleCoverage.reduce((s, r) => s + r.barCount, 0) +
    fundingCoverage.reduce((s, r) => s + r.count, 0) +
    oiCoverage.reduce((s, r) => s + r.count, 0) +
    liqCoverage.reduce((s, r) => s + r.count, 0) +
    lsCoverage.reduce((s, r) => s + r.count, 0);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
            ← Home
          </Link>
          <h1 className="text-xl font-semibold text-white">Market Data</h1>
        </div>
        <div className="text-xs text-gray-500">
          {fmtN(totalRows)} total rows across all tables
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">

        {/* ── Candle Coverage ───────────────────────────────────────────── */}
        <section>
          <SectionHeader title="OHLCV Candles" count={candleCoverage.length} />
          <CandleTable rows={candleCoverage} />
        </section>

        {/* ── Funding Rate Coverage ─────────────────────────────────────── */}
        <section>
          <SectionHeader title="Funding Rates" count={fundingCoverage.length} />
          <FundingRateTable rows={fundingCoverage} />
        </section>

        {/* ── Open Interest Coverage ────────────────────────────────────── */}
        <section>
          <SectionHeader title="Open Interest" count={oiCoverage.length} />
          <OpenInterestTable rows={oiCoverage} />
        </section>

        {/* ── Liquidations Coverage ─────────────────────────────────────── */}
        <section>
          <SectionHeader title="Liquidations (CoinGlass)" count={liqCoverage.length} />
          <LiquidationTable rows={liqCoverage} />
        </section>

        {/* ── Long/Short Ratios Coverage ────────────────────────────────── */}
        <section>
          <SectionHeader title="Long/Short Ratios (CoinGlass)" count={lsCoverage.length} />
          <LongShortRatioTable rows={lsCoverage} />
        </section>

        {/* ── Recent Jobs ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-lg font-semibold text-white">Recent Ingestion Jobs</h2>
            <span className="text-xs text-gray-500">last 20</span>
          </div>

          {recentJobs.length === 0 ? (
            <EmptyState message="No ingestion jobs recorded yet." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/50">
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Status</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Type</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Exchange</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Symbol</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">TF</th>
                    <th className="px-4 py-2 text-right text-gray-400 font-medium">Rows</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Started</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center text-xs text-gray-300">
                          {statusDot(job.status)}
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-xs font-mono">
                          {job.dataType}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-300 font-mono text-xs">{job.exchange}</td>
                      <td className="px-4 py-2 text-white font-mono text-xs">{job.symbol}</td>
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{job.timeframe}</td>
                      <td className="px-4 py-2 text-right text-white font-mono text-xs">
                        {job.rowsInserted != null ? fmtN(job.rowsInserted) : "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs font-mono">
                        {job.startedAt ? job.startedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className="px-4 py-2 text-red-400 text-xs max-w-xs truncate">
                        {job.error ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── CLI Quick Reference ───────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Ingest Commands</h2>
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-2 font-mono text-xs text-gray-400">
            <div>
              <span className="text-gray-600"># OHLCV candles (default)</span>
            </div>
            <div className="text-green-400">npm run ingest</div>
            <div className="text-green-400">
              npm run ingest -- --exchange bybit --symbol &quot;BTC/USDT:USDT&quot; --days 180
            </div>
            <div className="mt-3">
              <span className="text-gray-600"># Funding rates</span>
            </div>
            <div className="text-green-400">
              npm run ingest -- --dataType funding_rate --days 365
            </div>
            <div className="mt-3">
              <span className="text-gray-600"># Open interest</span>
            </div>
            <div className="text-green-400">
              npm run ingest -- --dataType open_interest --timeframe 1h
            </div>
            <div className="mt-3">
              <span className="text-gray-600"># Liquidations — requires COINGLASS_API_KEY</span>
            </div>
            <div className="text-green-400">
              npm run ingest -- --dataType liquidation --symbol BTC --timeframe 1h
            </div>
            <div className="text-green-400">
              npm run ingest -- --dataType liquidation --symbol ETH --timeframe 4h --days 180
            </div>
            <div className="mt-3">
              <span className="text-gray-600"># Long/short ratios — requires COINGLASS_API_KEY</span>
            </div>
            <div className="text-green-400">
              npm run ingest -- --dataType long_short --symbol BTC --timeframe 1d
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
