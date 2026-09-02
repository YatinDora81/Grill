-- AlterTable
ALTER TABLE "turns" ADD COLUMN     "question_payload" JSONB;
ALTER TABLE "turns" ADD COLUMN     "code_submission" JSONB;
