-- AlterTable
ALTER TABLE "turns" ADD COLUMN     "video_id" UUID,
ADD COLUMN     "video_offset_ms" INTEGER;

-- CreateTable
CREATE TABLE "session_videos" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "upload_id" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_videos_session_id_idx" ON "session_videos"("session_id");

-- CreateIndex
CREATE INDEX "session_videos_expires_at_idx" ON "session_videos"("expires_at");

-- CreateIndex
CREATE INDEX "turns_video_id_idx" ON "turns"("video_id");

-- AddForeignKey
ALTER TABLE "session_videos" ADD CONSTRAINT "session_videos_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "session_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
