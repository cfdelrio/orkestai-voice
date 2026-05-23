-- CreateTable ApiKey
CREATE TABLE "ApiKey" (
  "id"         TEXT        NOT NULL,
  "tenantId"   TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "keyHash"    TEXT        NOT NULL,
  "lastUsedAt" TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable WebhookEndpoint
CREATE TABLE "WebhookEndpoint" (
  "id"        TEXT        NOT NULL,
  "tenantId"  TEXT        NOT NULL,
  "url"       TEXT        NOT NULL,
  "secret"    TEXT        NOT NULL,
  "events"    JSONB       NOT NULL DEFAULT '[]',
  "enabled"   BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
