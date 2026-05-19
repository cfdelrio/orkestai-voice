-- CreateTable
CREATE TABLE "PublicFeedConfig" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "showTotalCalls" BOOLEAN NOT NULL DEFAULT true,
    "showResponseRate" BOOLEAN NOT NULL DEFAULT true,
    "showRecentActivity" BOOLEAN NOT NULL DEFAULT true,
    "showPercentages" BOOLEAN NOT NULL DEFAULT true,
    "refreshIntervalSeconds" INTEGER NOT NULL DEFAULT 10,
    "publicQuestions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicFeedConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicFeedConfig_campaignId_key" ON "PublicFeedConfig"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicFeedConfig_slug_key" ON "PublicFeedConfig"("slug");

-- AddForeignKey
ALTER TABLE "PublicFeedConfig" ADD CONSTRAINT "PublicFeedConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
