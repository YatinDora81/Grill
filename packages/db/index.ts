import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot create Prisma client");
  }
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
  return (globalForPrisma.prisma ??= createClient());
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
