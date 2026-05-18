-- Add User model for Clerk authentication
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add campaign execution timestamps
ALTER TABLE "Campaign" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "completedAt" TIMESTAMP(3);
