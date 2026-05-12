import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function migrate() {
  console.log('Duke kontrolluar bazën e të dhënave...')

  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Product' AND column_name = 'barcode'`
  )

  if (cols.length === 0) {
    console.log('Kolona barcode nuk ekziston — nuk nevojitet migrim.')
    console.log('Ekzekuto "npx prisma db push" për të sinkronizuar skemat.')
    return
  }

  console.log('Kolona barcode u gjet. Duke krijuar tabelën ProductBarcode...')

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductBarcode" (
      "id"        SERIAL                      PRIMARY KEY,
      "barcode"   TEXT                        NOT NULL UNIQUE,
      "productId" INTEGER                     NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
      "createdAt" TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const migrated = await prisma.$executeRawUnsafe(`
    INSERT INTO "ProductBarcode" ("barcode", "productId", "createdAt")
    SELECT "barcode", "id", CURRENT_TIMESTAMP
    FROM   "Product"
    WHERE  "barcode" IS NOT NULL
    ON CONFLICT ("barcode") DO NOTHING
  `)

  console.log(`U migruan ${migrated} barkode.`)

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Product" DROP COLUMN IF EXISTS "barcode"`
  )

  console.log('Kolona e vjetër barcode u fshi.')
  console.log('Tani ekzekuto: npx prisma db push')
}

migrate()
  .catch((e) => {
    console.error('Gabim gjatë migrimit:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
