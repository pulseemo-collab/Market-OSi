import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Seed suppliers
  const furnitor1 = await prisma.supplier.upsert({
    where: { id: 1 },
    update: {},
    create: {
      emri: 'Distribucioni Tirana',
      telefoni: '+355 69 123 4567',
      email: 'info@distrib-tirana.al',
      adresa: 'Rruga Kavajës, Tiranë',
      shenime: 'Furnitor kryesor për produkte ushqimore',
    },
  })

  const furnitor2 = await prisma.supplier.upsert({
    where: { id: 2 },
    update: {},
    create: {
      emri: 'Agro Fresh Albania',
      telefoni: '+355 68 234 5678',
      email: 'kontakt@agrofresh.al',
      adresa: 'Rruga e Durrësit, Tiranë',
      shenime: 'Produkte të freskëta dhe organike',
    },
  })

  // Seed products
  const products = [
    {
      emri: 'Bukë e Bardhë',
      barcode: '8001234567890',
      kategoria: 'Bukëpjekje',
      sasia: 45,
      stokuMinimal: 10,
      cmimiBlerjes: 50,
      cmimiShitjes: 80,
      njesia: 'copë',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Qumësht 1L',
      barcode: '8002345678901',
      kategoria: 'Bulmetore',
      sasia: 3,
      stokuMinimal: 15,
      cmimiBlerjes: 90,
      cmimiShitjes: 130,
      njesia: 'shishe',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Vezë (kuti 10)',
      barcode: '8003456789012',
      kategoria: 'Bulmetore',
      sasia: 20,
      stokuMinimal: 8,
      cmimiBlerjes: 180,
      cmimiShitjes: 250,
      njesia: 'kuti',
      furnitorId: furnitor2.id,
    },
    {
      emri: 'Vaj Ulliri 500ml',
      barcode: '8004567890123',
      kategoria: 'Vajra & Salca',
      sasia: 2,
      stokuMinimal: 5,
      cmimiBlerjes: 350,
      cmimiShitjes: 480,
      njesia: 'shishe',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Makarona 500g',
      barcode: '8005678901234',
      kategoria: 'Drithëra & Pasta',
      sasia: 60,
      stokuMinimal: 20,
      cmimiBlerjes: 70,
      cmimiShitjes: 110,
      njesia: 'paketë',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Djathë i Bardhë 400g',
      barcode: '8006789012345',
      kategoria: 'Bulmetore',
      sasia: 12,
      stokuMinimal: 10,
      cmimiBlerjes: 280,
      cmimiShitjes: 380,
      njesia: 'paketë',
      furnitorId: furnitor2.id,
    },
    {
      emri: 'Sheqer 1kg',
      barcode: '8007890123456',
      kategoria: 'Drithëra & Pasta',
      sasia: 35,
      stokuMinimal: 10,
      cmimiBlerjes: 100,
      cmimiShitjes: 150,
      njesia: 'qese',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Kafe Lavazza 250g',
      barcode: '8008901234567',
      kategoria: 'Pije & Kafe',
      sasia: 4,
      stokuMinimal: 6,
      cmimiBlerjes: 450,
      cmimiShitjes: 620,
      njesia: 'paketë',
      furnitorId: furnitor1.id,
    },
    {
      emri: 'Ujë Mineral 1.5L',
      barcode: '8009012345678',
      kategoria: 'Pije & Kafe',
      sasia: 80,
      stokuMinimal: 24,
      cmimiBlerjes: 35,
      cmimiShitjes: 60,
      njesia: 'shishe',
      furnitorId: furnitor2.id,
    },
    {
      emri: 'Ketchup Heinz 300g',
      barcode: '8000123456789',
      kategoria: 'Vajra & Salca',
      sasia: 18,
      stokuMinimal: 8,
      cmimiBlerjes: 220,
      cmimiShitjes: 320,
      njesia: 'shishe',
      furnitorId: furnitor1.id,
    },
  ]

  for (const product of products) {
    await prisma.product.upsert({
      where: { barcode: product.barcode },
      update: {},
      create: product,
    })
  }

  console.log('✅ Databaza u inicializua me të dhëna testimi')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
