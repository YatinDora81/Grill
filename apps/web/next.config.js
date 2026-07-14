import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Pin the monorepo root so Turbopack doesn't misdetect it from a stray lockfile.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: repoRoot },
  // Workspace packages shipped as TS source — Next must transpile them.
  transpilePackages: ["@repo/db", "@repo/types", "@repo/ui"],
  // Native / Node-only deps: keep them external so Next doesn't try to bundle
  // the Prisma engine, pg, or the argon2 native binary.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "@node-rs/argon2",
  ],
};

export default nextConfig;
