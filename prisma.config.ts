import "dotenv/config";
import { defineConfig } from "prisma/config";

const LOCAL_GENERATE_DATABASE_URL =
  "postgresql://finproof:finproof@localhost:5432/finproof_agent?schema=public";

function isGenerateCommand() {
  return process.argv.some((arg) => arg === "generate");
}

function databaseUrlForPrismaCli() {
  const directUrl = process.env.DIRECT_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const url = directUrl || databaseUrl;

  if (url) {
    return url;
  }

  if (isGenerateCommand()) {
    return LOCAL_GENERATE_DATABASE_URL;
  }

  throw new Error("DIRECT_URL or DATABASE_URL is required for Prisma CLI commands");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: databaseUrlForPrismaCli()
  }
});
