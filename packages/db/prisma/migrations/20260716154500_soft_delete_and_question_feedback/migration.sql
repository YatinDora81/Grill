-- Soft-delete for interviews + per-question coaching on reports.

ALTER TABLE "ai_interview"."sessions"
ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE INDEX "sessions_user_id_deleted_at_idx"
ON "ai_interview"."sessions"("user_id", "deleted_at");

ALTER TABLE "ai_interview"."reports"
ADD COLUMN "question_feedback" JSONB NOT NULL DEFAULT '[]';
