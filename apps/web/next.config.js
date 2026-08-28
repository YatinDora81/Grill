import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: repoRoot },
  transpilePackages: ["@repo/db", "@repo/types"],
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "@node-rs/argon2",
  ],
};

export default nextConfig;
