import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { runDailyBackup } from './backup'
import { isDemoMode } from './demoMode'

/**
 * The app keeps TWO databases:
 *   • the real one  — prisma/data.db   (from DATABASE_URL, your private data)
 *   • the demo one  — prisma/demo.db   (seeded fake data, for showing people)
 *
 * We build a Prisma client for each, then export a single `prisma` Proxy that
 * forwards every call to whichever database "demo mode" currently selects (see
 * demoMode.ts). Because the choice is resolved on each property access, flipping
 * demo mode takes effect on the very next query — no rebuild, no re-import. All
 * 25 routers keep importing `prisma` from here and need no changes.
 */

const globalForPrisma = globalThis as unknown as {
  realPrisma?: PrismaClient
  demoPrisma?: PrismaClient
}

// Real client: default construction reads DATABASE_URL (file:./data.db).
export const realPrisma =
  globalForPrisma.realPrisma ?? new PrismaClient({ log: ['error', 'warn'] })

// Demo client: pinned to an ABSOLUTE path so it never depends on how relative
// SQLite URLs resolve at runtime. Lives alongside the real DB in prisma/.
const DEMO_DB_URL = 'file:' + path.join(process.cwd(), 'prisma', 'demo.db')
const demoPrisma =
  globalForPrisma.demoPrisma ??
  new PrismaClient({ log: ['error', 'warn'], datasources: { db: { url: DEMO_DB_URL } } })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.realPrisma = realPrisma
  globalForPrisma.demoPrisma = demoPrisma
}

/**
 * The exported client. A Proxy that resolves the active database per access.
 * Top-level methods ($transaction, $connect, …) are bound to the active client
 * so `this` is correct; delegate objects (prisma.task, prisma.event, …) are
 * already bound internally and pass through untouched.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = isDemoMode() ? demoPrisma : realPrisma
    const value = Reflect.get(client, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// One safety copy of the REAL data.db per day, taken on first server boot of the
// day (backup.ts only ever touches data.db — demo data is disposable).
runDailyBackup()
