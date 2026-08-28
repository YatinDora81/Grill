import { test, expect } from "bun:test";

test("importing the package does not require DATABASE_URL", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete (globalThis as { prisma?: unknown }).prisma;
  try {
    const mod = await import("./index");
    expect(mod.prisma).toBeDefined();
    expect(() => (mod.prisma as { $connect: unknown }).$connect).toThrow(/DATABASE_URL/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test("every access shares one client in production — the delegate is stable", async () => {
  const savedEnv = process.env.NODE_ENV;
  Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/x?schema=ai_interview";
  delete (globalThis as { prisma?: unknown }).prisma;

  try {
    const { prisma } = await import("./index");
    const p = prisma as unknown as Record<string, unknown>;

    expect(p.user).toBe(p.user);
    expect(p.session).toBe(p.session);

    expect((globalThis as { prisma?: unknown }).prisma).toBeDefined();
  } finally {
    Object.defineProperty(process.env, "NODE_ENV", { value: savedEnv, configurable: true });
  }
});

test("a ?schema= in the URL is carried onto the adapter without throwing", async () => {
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/x?schema=ai_interview";
  delete (globalThis as { prisma?: unknown }).prisma;

  const { prisma } = await import("./index");
  expect((prisma as { user: unknown }).user).toBeDefined();
});
