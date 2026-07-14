-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "retry_of_id" UUID;

-- CreateIndex
CREATE INDEX "sessions_retry_of_id_idx" ON "sessions"("retry_of_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
