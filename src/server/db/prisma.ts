import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  finproofPrisma?: PrismaClient;
};

function connectionString() {
  const value = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is required when FINPROOF_REVIEW_STORE=prisma");
  }

  return value;
}

export function getPrismaClient() {
  globalForPrisma.finproofPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString() }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

  return globalForPrisma.finproofPrisma;
}
