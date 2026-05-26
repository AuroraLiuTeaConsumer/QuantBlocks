#!/usr/bin/env tsx
/**
 * Creates the TimescaleDB market-data schema for QuantBlocks.
 *
 * Run once after starting the TimescaleDB container:
 *
 *   npm run setup:timescale
 *
 * Safe to re-run — all DDL uses IF NOT EXISTS.
 *
 * Prerequisites:
 *   docker-compose up -d     (TimescaleDB must be running)
 *   DATABASE_URL in .env     (same connection string Prisma uses)
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";

// Load .env before anything else
const envFiles = [".env.local", ".env"];
for (const f of envFiles) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^"|"$/g, "");
    }
    break;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌  DATABASE_URL is not set.");
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations", "timescale");

async function run() {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No SQL migration files found in", MIGRATIONS_DIR);
      return;
    }

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, "utf-8");
      console.log(`▶  ${file} …`);
      await client.query(sql);
      console.log(`✓  ${file} done`);
    }

    console.log("\n✅  TimescaleDB schema ready.\n");
    console.log("Next steps:");
    console.log(
      "  1. npx prisma migrate dev --name add_ingestion_job   (first time only)",
    );
    console.log(
      "  2. npm run ingest                                     (backfill BTC/USDT:USDT 1h, 90 days)",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌  Setup failed:", err.message);
  process.exit(1);
});
