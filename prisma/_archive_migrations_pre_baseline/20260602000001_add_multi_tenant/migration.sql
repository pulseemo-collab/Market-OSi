-- CreateTable: Organization
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- Seed default organization (id = 1)
INSERT INTO "Organization" ("name", "updatedAt") VALUES ('Default Market', NOW());

-- Add organizationId to Supplier (with temp default so existing rows get value 1)
ALTER TABLE "Supplier" ADD COLUMN "organizationId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Supplier" ALTER COLUMN "organizationId" DROP DEFAULT;

-- Add organizationId to Product
ALTER TABLE "Product" ADD COLUMN "organizationId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ALTER COLUMN "organizationId" DROP DEFAULT;

-- Add organizationId to Supply
ALTER TABLE "Supply" ADD COLUMN "organizationId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Supply" ALTER COLUMN "organizationId" DROP DEFAULT;

-- Add organizationId to Sale
ALTER TABLE "Sale" ADD COLUMN "organizationId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Sale" ALTER COLUMN "organizationId" DROP DEFAULT;

-- Add organizationId to UserRole
ALTER TABLE "UserRole" ADD COLUMN "organizationId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserRole" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AddForeignKey constraints
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Supply" ADD CONSTRAINT "Supply_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
