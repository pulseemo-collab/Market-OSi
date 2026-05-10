-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "emri" TEXT NOT NULL,
    "telefoni" TEXT,
    "email" TEXT,
    "adresa" TEXT,
    "shenime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "emri" TEXT NOT NULL,
    "barcode" TEXT,
    "kategoria" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stokuMinimal" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "cmimiShitjes" DOUBLE PRECISION NOT NULL,
    "njesia" TEXT NOT NULL DEFAULT 'cope',
    "furnitorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "totali" DOUBLE PRECISION NOT NULL,
    "fitimi" DOUBLE PRECISION NOT NULL,
    "shenime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "emriProduktit" TEXT NOT NULL,
    "sasia" DOUBLE PRECISION NOT NULL,
    "cmimiBlerjes" DOUBLE PRECISION NOT NULL,
    "cmimiShitjes" DOUBLE PRECISION NOT NULL,
    "fitimi" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_furnitorId_fkey" FOREIGN KEY ("furnitorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
