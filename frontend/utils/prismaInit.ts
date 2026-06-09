// prismaInit.ts
// Creates and exports the single shared Prisma database client for the whole app.
//
// WHY A SINGLETON (only one instance)?
// Prisma opens a *connection pool* when you call `new PrismaClient()`. A pool
// is a set of persistent connections to the database so you don't pay the
// overhead of connecting on every query. If you accidentally create multiple
// PrismaClient instances, you open multiple pools — wasting connections and
// potentially hitting the database's max-connection limit.
//
// WHY GLOBALTHIS?
// Next.js dev mode re-evaluates every module on each file-save (hot-reload).
// Without the globalThis trick, a new PrismaClient (and new pool) would be
// created on every reload. By stashing the instance on globalThis (the global
// object, equivalent to `window` in browsers and `global` in Node), it survives
// module re-evaluations. In production, modules are only evaluated once, so this
// guard is never needed — but it's harmless.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Prisma v7 requires an explicit database adapter; the default pg driver was removed.
// PrismaPg wraps the pg npm package. DATABASE_URL is the pooled connection string.
// The ! after DATABASE_URL tells TypeScript "trust me, this env var is defined".
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

// Cast globalThis so TypeScript allows reading/writing a `prisma` property on it.
// Without this cast TypeScript would complain that `prisma` doesn't exist on globalThis.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Reuse the existing instance if one is already stored on globalThis (dev hot-reload),
// otherwise create a fresh one.
const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

// In dev, save the instance back to globalThis so the next hot-reload finds it.
// In production, skip this — modules only load once and we don't want to pollute globals.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { prisma };
