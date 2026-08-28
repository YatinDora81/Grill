-- CreateTable
CREATE TABLE "company_briefs" (
    "id" UUID NOT NULL,
    "company_key" VARCHAR(120) NOT NULL,
    "role_key" VARCHAR(120) NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT,
    "brief" JSONB NOT NULL,
    "grounded" BOOLEAN NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_briefs_company_key_role_key_key" ON "company_briefs"("company_key", "role_key");
