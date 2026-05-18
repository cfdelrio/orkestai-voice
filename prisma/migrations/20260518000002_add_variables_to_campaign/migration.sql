-- AlterTable: add variables column to Campaign with empty object default
ALTER TABLE "Campaign" ADD COLUMN "variables" JSONB NOT NULL DEFAULT '{}';
