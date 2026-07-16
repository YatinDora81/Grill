import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

/**
 * Single shared Prisma client for the whole process, created lazily.
 * Uses the pg driver adapter (Prisma 7) so it runs cleanly under Bun.
 * The connection string comes only from env — never hardcoded (BACKEND_README §14).
 *
 * Lazy so that importing this package doesn't require DATABASE_URL to be set;
 * the client is only built on first DB access, which keeps the API bootable
 * for non-DB work (config checks, provider-client tests) before a real
 * Postgres URL is configured.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot create Prisma client");
  }
  // Honour a non-default schema (e.g. ?schema=ai_interview) so generated
  // queries target the right Postgres schema, not public.
  let schema: string | undefined;
  try {
    schema = new URL(connectionString).searchParams.get("schema") ?? undefined;
  } catch {
    /* non-URL connection string — leave schema undefined */
  }
  const adapter = new PrismaPg({ connectionString }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}

/**
 * The cache is unconditional, and must stay that way.
 *
 * The usual Next idiom only stashes the client on globalThis outside production,
 * because there a module-level `const` already holds it and the global exists
 * purely to survive HMR. Here the module-level export is the Proxy below, not
 * the client — so nothing else holds one, and skipping the assignment in
 * production meant `globalForPrisma.prisma` stayed undefined forever and every
 * property access built a fresh PrismaClient with its own pg pool. One request
 * through repo.ts is several such clients; `$transaction` in markAudioPurged
 * resolved to three different ones, which is not a transaction at all.
 */
function getClient(): PrismaClient {
  return (globalForPrisma.prisma ??= createClient());
}

/** Lazy proxy: the real client is constructed on first property access. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
