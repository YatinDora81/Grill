-- AlterTable
ALTER TABLE "turns" ADD COLUMN     "response_latency_ms" INTEGER;
ALTER TABLE "turns" ADD COLUMN     "interrupted_at_s" INTEGER;
