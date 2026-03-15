-- AlterTable
ALTER TABLE "PaperSession" ADD COLUMN     "engineState" JSONB,
ADD COLUMN     "positionOpenedAt" TIMESTAMP(3);
