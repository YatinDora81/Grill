-- CreateEnum
CREATE TYPE "question_set_source" AS ENUM ('resume', 'topic', 'cultural');

-- CreateTable
CREATE TABLE "question_sets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" "question_set_source" NOT NULL,
    "source_text" TEXT NOT NULL,
    "role" TEXT,
    "difficulty" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_set_items" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "item_index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "question_type" "question_type" NOT NULL,

    CONSTRAINT "question_set_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "question_set_id" UUID;

-- CreateIndex
CREATE INDEX "question_sets_user_id_deleted_at_idx" ON "question_sets"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "question_set_items_set_id_idx" ON "question_set_items"("set_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_set_items_set_id_item_index_key" ON "question_set_items"("set_id", "item_index");

-- CreateIndex
CREATE INDEX "sessions_question_set_id_idx" ON "sessions"("question_set_id");

-- AddForeignKey
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_items" ADD CONSTRAINT "question_set_items_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_question_set_id_fkey" FOREIGN KEY ("question_set_id") REFERENCES "question_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
