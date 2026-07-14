-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('resume', 'jd', 'topic');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('in_progress', 'generating_report', 'completed', 'cancelled', 'abandoned', 'error');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('technical', 'behavioral', 'followup');

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "source_type" "source_type" NOT NULL,
    "source_text" TEXT NOT NULL,
    "role" TEXT,
    "config" JSONB NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'in_progress',
    "error_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turns" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "question_type" "question_type" NOT NULL,
    "audio_url" TEXT,
    "transcript" TEXT,
    "transcript_words" JSONB,
    "answer_scores" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "category_scores" JSONB NOT NULL,
    "delivery_metrics" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "best_answer" JSONB,
    "worst_answer" JSONB,
    "next_steps" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "turns_session_id_idx" ON "turns"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "turns_session_id_turn_index_key" ON "turns"("session_id", "turn_index");

-- CreateIndex
CREATE UNIQUE INDEX "reports_session_id_key" ON "reports"("session_id");

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
