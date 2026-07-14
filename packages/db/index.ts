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

function getClient(): PrismaClient {
  const existing = globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = existing;
  return existing;
}

/** Lazy proxy: the real client is constructed on first property access. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
