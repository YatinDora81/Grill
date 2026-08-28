-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_digest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_digest_at" TIMESTAMPTZ(6),
ADD COLUMN     "timezone" VARCHAR(64);

-- CreateTable
CREATE TABLE "drill_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "question_type" "question_type" NOT NULL,
    "question_hash" CHAR(64) NOT NULL,
    "source_turn_id" UUID,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval_days" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_grade" INTEGER,
    "best_transcript" TEXT,
    "best_mean" DOUBLE PRECISION,
    "suspended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drill_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drill_reviews" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "grade" INTEGER NOT NULL,
    "transcript" TEXT,
    "answer_scores" JSONB,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drill_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drill_cards_user_id_suspended_at_due_at_idx" ON "drill_cards"("user_id", "suspended_at", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "drill_cards_user_id_question_hash_key" ON "drill_cards"("user_id", "question_hash");

-- CreateIndex
CREATE INDEX "drill_reviews_user_id_reviewed_at_idx" ON "drill_reviews"("user_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "drill_reviews_card_id_idx" ON "drill_reviews"("card_id");

-- AddForeignKey
ALTER TABLE "drill_cards" ADD CONSTRAINT "drill_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drill_reviews" ADD CONSTRAINT "drill_reviews_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "drill_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
