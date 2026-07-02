-- AlterTable: add worker mode and accelerated-replay fields to PaperSession
ALTER TABLE "PaperSession"
  ADD COLUMN "mode"         TEXT    NOT NULL DEFAULT 'poll',
  ADD COLUMN "replaySpeed"  INTEGER,
  ADD COLUMN "replayUntil"  TIMESTAMP(3);
