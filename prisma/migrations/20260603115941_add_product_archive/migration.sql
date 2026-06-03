-- AlterTable
ALTER TABLE "Product" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "archivedAt" TIMESTAMP(3);
