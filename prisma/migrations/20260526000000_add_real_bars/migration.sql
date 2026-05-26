-- AlterTable: add real-bar replay fields to PaperSession
ALTER TABLE "PaperSession"
  ADD COLUMN "useRealBars" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "barCursor"   TIMESTAMP(3);
