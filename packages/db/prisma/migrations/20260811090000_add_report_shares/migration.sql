-- CreateTable
CREATE TABLE "ai_interview"."report_shares" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_shares_session_id_key" ON "ai_interview"."report_shares"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_shares_token_hash_key" ON "ai_interview"."report_shares"("token_hash");

-- AddForeignKey
ALTER TABLE "ai_interview"."report_shares" ADD CONSTRAINT "report_shares_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_interview"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
