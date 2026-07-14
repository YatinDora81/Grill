/*
  Warnings:

  - Added the required column `verdict` to the `reports` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "verdict" TEXT NOT NULL;
