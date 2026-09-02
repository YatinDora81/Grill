-- AlterTable
ALTER TABLE "turns" ADD COLUMN     "design_key" TEXT;
ALTER TABLE "turns" ADD COLUMN     "design_image_key" TEXT;
ALTER TABLE "turns" ADD COLUMN     "design_review" JSONB;
