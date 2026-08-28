import { createRequire } from "node:module";
import { defineConfig, env } from "prisma/config";

try {
  createRequire(import.meta.url)("dotenv/config");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
