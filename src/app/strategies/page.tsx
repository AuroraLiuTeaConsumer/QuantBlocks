import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const strategies = await prisma.strategy.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Strategies</h1>
        <Link
          href="/"
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Home
        </Link>
      </div>

      {strategies.length === 0 ? (
        <p className="text-gray-500">No strategies yet. Create one via the API.</p>
      ) : (
        <ul className="space-y-3">
          {strategies.map((s) => (
            <li key={s.id}>
              <Link
                href={`/strategies/${s.id}`}
                className="block p-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {s.instrument} &middot; {s.timeframe} &middot;{" "}
                  {(s.nodes as unknown[]).length} nodes
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
