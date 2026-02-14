-- CreateTable
CREATE TABLE "PaperSession" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "instrument" TEXT NOT NULL DEFAULT 'BTC-PERP',
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "lastPrice" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionSide" TEXT,
    "positionQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionEntryPrice" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "entryTime" TIMESTAMP(3) NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitTime" TIMESTAMP(3),
    "exitPrice" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperSession_strategyId_idx" ON "PaperSession"("strategyId");

-- CreateIndex
CREATE INDEX "PaperTrade_sessionId_entryTime_idx" ON "PaperTrade"("sessionId", "entryTime");

-- AddForeignKey
ALTER TABLE "PaperSession" ADD CONSTRAINT "PaperSession_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaperSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
