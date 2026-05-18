-- AlterTable: add voice column to VoiceFlow with default
ALTER TABLE "VoiceFlow" ADD COLUMN "voice" TEXT NOT NULL DEFAULT 'Polly.Mia-Neural';
