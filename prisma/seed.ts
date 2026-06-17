import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // ─── Default Focus-mode timers (only if none exist) ────────────────────────────

  const focusTimerCount = await prisma.focusTimer.count()
  if (focusTimerCount === 0) {
    await prisma.focusTimer.createMany({
      data: [
        { name: 'Classic', workMin: 25, breakMin: 5, position: 0 },
        { name: '52 / 17', workMin: 52, breakMin: 17, position: 1 },
        { name: 'Deep', workMin: 90, breakMin: 20, position: 2 },
      ],
    })
    console.log('Seeded 3 default focus timers')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
