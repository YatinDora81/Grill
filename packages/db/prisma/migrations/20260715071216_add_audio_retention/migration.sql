-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "audio_purged_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "sessions_audio_purged_at_created_at_idx" ON "sessions"("audio_purged_at", "created_at");
