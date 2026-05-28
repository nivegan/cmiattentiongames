import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

// PrismaPg driver adapter is required because Prisma v7 dropped the default pg
// driver in favor of explicit adapters. DATABASE_URL uses a pooled connection.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

// In Next.js dev mode the module is re-evaluated on every hot-reload, which
// would create a new PrismaClient (and connection pool) each time. Stashing the
// instance on globalThis prevents that leak. In production modules are only
// evaluated once, so the guard is a no-op there.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { prisma };
