-- CreateTable
CREATE TABLE "starred_questions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "question_type" "question_type" NOT NULL,
    "question_hash" CHAR(64) NOT NULL,
    "turn_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "starred_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "starred_questions_user_id_idx" ON "starred_questions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "starred_questions_user_id_question_hash_key" ON "starred_questions"("user_id", "question_hash");

-- AddForeignKey
ALTER TABLE "starred_questions" ADD CONSTRAINT "starred_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_questions" ADD CONSTRAINT "starred_questions_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
