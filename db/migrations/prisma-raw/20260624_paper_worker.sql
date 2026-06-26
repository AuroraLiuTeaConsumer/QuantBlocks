-- Run order: npx prisma db execute --stdin < db/migrations/prisma-raw/20260624_paper_worker.sql
--            → npx prisma migrate resolve --applied 20260624_paper_worker
--            → npx prisma generate
ALTER TABLE "PaperSession"
  ADD COLUMN IF NOT EXISTS "mode"         TEXT    NOT NULL DEFAULT 'poll',
  ADD COLUMN IF NOT EXISTS "replaySpeed"  INTEGER,
  ADD COLUMN IF NOT EXISTS "replayUntil"  TIMESTAMP(3);
