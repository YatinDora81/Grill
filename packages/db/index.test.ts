import { test, expect } from "bun:test";

/**
 * The lazy shared client.
 *
 * The export is a Proxy that builds the real PrismaClient on first access and
 * caches it on globalThis. Two things it must get right, both of which regressed
 * once already:
 *
 *  - it stays LAZY — importing the package must not need DATABASE_URL, so the API
 *    can boot for config checks before a Postgres URL exists;
 *  - it stays SHARED — one client for the process, not a fresh one (and a fresh
 *    pg pool) per property access. The bug was memoizing only outside production,
 *    which left production building a client on every access.
 */

test("importing the package does not require DATABASE_URL", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete (globalThis as { prisma?: unknown }).prisma;
  try {
    // The import must succeed with no connection string; only a real query would
    // throw. This is what keeps the app bootable for non-DB work.
    const mod = await import("./index");
    expect(mod.prisma).toBeDefined();
    expect(() => (mod.prisma as { $connect: unknown }).$connect).toThrow(/DATABASE_URL/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test("every access shares one client in production — the delegate is stable", async () => {
  // Under production specifically: the bug memoized only when NODE_ENV was NOT
  // production, so this assertion is green on the buggy code everywhere except
  // here — which is the one environment that ships.
  const savedEnv = process.env.NODE_ENV;
  Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/x?schema=ai_interview";
  delete (globalThis as { prisma?: unknown }).prisma;

  try {
    const { prisma } = await import("./index");
    const p = prisma as unknown as Record<string, unknown>;

    // A model delegate is a plain object on the client, so its identity tracks
    // the client behind it. Rebuild-per-access makes these differ.
    expect(p.user).toBe(p.user);
    expect(p.session).toBe(p.session);

    // The cache lives on globalThis, so the whole process resolves to it.
    expect((globalThis as { prisma?: unknown }).prisma).toBeDefined();
  } finally {
    Object.defineProperty(process.env, "NODE_ENV", { value: savedEnv, configurable: true });
  }
});

test("a ?schema= in the URL is carried onto the adapter without throwing", async () => {
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/x?schema=ai_interview";
  delete (globalThis as { prisma?: unknown }).prisma;

  const { prisma } = await import("./index");
  // Touching a property builds the client; a bad schema wiring would throw here.
  expect((prisma as { user: unknown }).user).toBeDefined();
});
