import { createRequire } from "node:module";
import { defineConfig, env } from "prisma/config";

// Local CLI loads packages/db/.env. Docker/CI already inject DATABASE_URL —
// and bunx may not resolve workspace-hoisted dotenv from this path.
try {
  createRequire(import.meta.url)("dotenv/config");
} catch {
  /* env already provided */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
