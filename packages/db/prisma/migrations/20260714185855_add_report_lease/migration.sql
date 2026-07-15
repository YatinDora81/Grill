-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "report_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "report_lease_until" TIMESTAMPTZ(6);
