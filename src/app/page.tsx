import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
      <h1 className="text-4xl font-bold">QuantBlocks</h1>
      <p className="text-gray-400 max-w-md text-center">
        Strategy building + backtesting + paper execution workspace for BTC-PERP perpetual trading.
      </p>
      <div className="flex gap-3">
        <Link
          href="/strategies"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
        >
          View Strategies
        </Link>
        <Link
          href="/market-data"
          className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors text-gray-300"
        >
          Market Data
        </Link>
      </div>
    </main>
  );
}
