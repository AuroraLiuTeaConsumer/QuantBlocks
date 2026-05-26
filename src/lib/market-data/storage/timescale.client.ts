import { Pool } from "pg";

/**
 * Singleton pg Pool for TimescaleDB.
 *
 * Uses the same DATABASE_URL as Prisma — both connect to the same PostgreSQL
 * instance. Prisma manages application tables; this pool handles market-data
 * hypertables via raw SQL.
 *
 * The global declaration prevents pool proliferation during Next.js hot-reload.
 */
declare global {
  // eslint-disable-next-line no-var
  var __timescalePool: Pool | undefined;
}

export function getTimescalePool(): Pool {
  if (!global.__timescalePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. " +
          "Ensure your .env file is loaded and docker-compose is running.",
      );
    }

    global.__timescalePool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    global.__timescalePool.on("error", (err) => {
      console.error("[TimescaleDB] Pool error:", err.message);
    });
  }

  return global.__timescalePool;
}
