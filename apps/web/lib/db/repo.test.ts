import { test, expect, beforeEach, mock } from "bun:test";

type Select = Record<string, unknown>;

function project(row: Record<string, unknown> | null, select?: Select): unknown {
  if (row === null || row === undefined) return null;
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === true) {
      out[key] = row[key];
      continue;
    }
    if (value && typeof value === "object") {
      const child = row[key] as Record<string, unknown> | null | undefined;
      const nested = (value as { select?: Select }).select;
      out[key] = child === null || child === undefined ? null : project(child, nested);
    }
  }
  return out;
}

interface SessionRow extends Record<string, unknown> {
  id: string;
  userId: string;
  name: string | null;
  role: string | null;
  status: string;
  createdAt: Date;
  retryOfId: string | null;
  deletedAt: Date | null;
  sourceText: string;
  config: unknown;
  report: Record<string, unknown> | null;
  _count: { turns: number };
  turns: { transcript: string; audioKey: string }[];
}

interface ShareRow {
  id: string;
  sessionId: string;
  tokenHash: string;
  revokedAt: Date | null;
}

let sessions: Map<string, SessionRow>;
let shares: ShareRow[];
let sessionQueries: string[];

mock.module("server-only", () => ({}));

mock.module("@repo/db", () => ({
  Prisma: { JsonNull: Symbol("JsonNull") },
  prisma: {
    session: {
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Select }) => {
        sessionQueries.push(String(where.id));
        const row = sessions.get(String(where.id));
        if (!row) return null;
        if (where.userId !== undefined && row.userId !== where.userId) return null;
        if (where.deletedAt === null && row.deletedAt !== null) return null;
        return project(row, select);
      },
    },
    reportShare: {
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Select }) => {
        const share = shares.find((s) => s.tokenHash === where.tokenHash);
        if (!share) return null;
        if (where.revokedAt === null && share.revokedAt !== null) return null;
        const gate = (where.session ?? {}) as Record<string, unknown>;
        const session = sessions.get(share.sessionId);
        if (!session) return null;
        if (gate.status !== undefined && session.status !== gate.status) return null;
        if (gate.deletedAt === null && session.deletedAt !== null) return null;
        return project({ id: share.id, session }, select);
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = shares.find((s) => s.sessionId === where.sessionId);
        if (existing) {
          Object.assign(existing, update);
          return { id: existing.id };
        }
        const row: ShareRow = {
          id: `sh-${shares.length + 1}`,
          sessionId: String(create.sessionId),
          tokenHash: String(create.tokenHash),
          revokedAt: null,
        };
        shares.push(row);
        return { id: row.id };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const gate = (where.session ?? {}) as Record<string, unknown>;
        const matches = shares.filter((s) => {
          if (s.sessionId !== where.sessionId) return false;
          if (where.revokedAt === null && s.revokedAt !== null) return false;
          const session = sessions.get(s.sessionId);
          if (!session) return false;
          if (gate.userId !== undefined && session.userId !== gate.userId) return false;
          if (gate.deletedAt === null && session.deletedAt !== null) return false;
          return true;
        });
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
    },
  },
}));

const repo = await import("./repo");

const OWNER = "user-1";
const SECRETS = ["RESUME BODY", "I said um a lot", "audio/s1/turn_0.webm", "RAW MODEL OUTPUT"];

function makeSession(over: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    userId: OWNER,
    name: `Interview ${over.id}`,
    role: "Backend engineer",
    status: "completed",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    retryOfId: null,
    deletedAt: null,
    sourceText: "RESUME BODY",
    config: { mode: "standard", job_description: "SECRET JD" },
    report: null,
    _count: { turns: 8 },
    turns: [{ transcript: "I said um a lot", audioKey: "audio/s1/turn_0.webm" }],
    ...over,
  };
}

function makeReport(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    overallScore: 64,
    verdict: "Pressed",
    categoryScores: { technical: 6 },
    deliveryMetrics: { wpm: 138, filler_count: 12 },
    strengths: ["Clear framing"],
    weaknesses: ["Thin on specifics"],
    bestAnswer: { transcript: "I said um a lot" },
    worstAnswer: { transcript: "I said um a lot" },
    nextSteps: ["Drill system design"],
    questionFeedback: [{ question: "Walk me through it", improve: "I said um a lot" }],
    raw: { text: "RAW MODEL OUTPUT" },
    ...over,
  };
}

function chain(ids: string[], scores: (number | null)[] = []) {
  ids.forEach((id, i) => {
    const score = scores[i];
    sessions.set(
      id,
      makeSession({
        id,
        retryOfId: i === 0 ? null : ids[i - 1]!,
        createdAt: new Date(Date.UTC(2026, 0, i + 1)),
        report: score === null || score === undefined ? null : makeReport({ overallScore: score }),
      }),
    );
  });
}

beforeEach(() => {
  sessions = new Map();
  shares = [];
  sessionQueries = [];
});

test("listRetryChain returns the walk oldest→newest with each hop's score", async () => {
  chain(["v1", "v2", "v3"], [58, 64, 72]);

  const hops = await repo.listRetryChain("v3", OWNER);

  expect(hops.map((h) => h.id)).toEqual(["v1", "v2", "v3"]);
  expect(hops.map((h) => h.overallScore)).toEqual([58, 64, 72]);
  expect(hops.map((h) => h.createdAt.getTime())).toEqual([...hops.map((h) => h.createdAt.getTime())].sort((a, b) => a - b));
  expect(hops[0]!.name).toBe("Interview v1");
});

test("listRetryChain keeps an unbuilt hop as a null score rather than dropping it", async () => {
  chain(["v1", "v2"], [58, null]);

  const hops = await repo.listRetryChain("v2", OWNER);

  expect(hops.map((h) => h.id)).toEqual(["v1", "v2"]);
  expect(hops[1]!.overallScore).toBeNull();
});

test("listRetryChain stops at MAX_RETRY_CHAIN_HOPS instead of walking a long chain", async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `v${i + 1}`);
  chain(ids);

  const hops = await repo.listRetryChain("v25", OWNER);

  expect(repo.MAX_RETRY_CHAIN_HOPS).toBe(10);
  expect(hops).toHaveLength(10);
  expect(sessionQueries).toHaveLength(10);
  expect(hops.map((h) => h.id)).toEqual(ids.slice(15));
});

test("listRetryChain terminates on a cycle without repeating a hop", async () => {
  sessions.set("a", makeSession({ id: "a", retryOfId: "b" }));
  sessions.set("b", makeSession({ id: "b", retryOfId: "a" }));

  const hops = await repo.listRetryChain("a", OWNER);

  expect(hops.map((h) => h.id)).toEqual(["b", "a"]);
  expect(sessionQueries).toHaveLength(2);
});

test("listRetryChain truncates at a soft-deleted ancestor", async () => {
  chain(["v1", "v2", "v3"], [58, 64, 72]);
  sessions.get("v1")!.deletedAt = new Date();

  const hops = await repo.listRetryChain("v3", OWNER);

  expect(hops.map((h) => h.id)).toEqual(["v2", "v3"]);
});

test("listRetryChain is empty for another user's session", async () => {
  chain(["v1", "v2"], [58, 64]);

  expect(await repo.listRetryChain("v2", "user-2")).toEqual([]);
});

test("listRetryChain stops rather than crossing into another user's parent", async () => {
  chain(["v1", "v2"], [58, 64]);
  sessions.get("v1")!.userId = "user-2";

  const hops = await repo.listRetryChain("v2", OWNER);

  expect(hops.map((h) => h.id)).toEqual(["v2"]);
});

function shareFixture(over: { revokedAt?: Date | null; status?: string; deletedAt?: Date | null } = {}) {
  sessions.set(
    "s1",
    makeSession({
      id: "s1",
      name: "Staff backend, round 2",
      status: over.status ?? "completed",
      deletedAt: over.deletedAt ?? null,
      report: makeReport(),
    }),
  );
  shares.push({ id: "sh1", sessionId: "s1", tokenHash: "hash-1", revokedAt: over.revokedAt ?? null });
}

test("getSharedReport returns the public subset for a live share", async () => {
  shareFixture();

  const out = await repo.getSharedReport("hash-1");

  expect(out).not.toBeNull();
  expect(Object.keys(out!).sort()).toEqual(
    [
      "categoryScores",
      "createdAt",
      "deliveryMetrics",
      "name",
      "overallScore",
      "questionCount",
      "role",
      "sessionId",
      "strengths",
      "verdict",
      "weaknesses",
    ].sort(),
  );
  expect(out!.overallScore).toBe(64);
  expect(out!.verdict).toBe("Pressed");
  expect(out!.name).toBe("Staff backend, round 2");
  expect(out!.questionCount).toBe(8);
});

test("getSharedReport leaks no transcript, media key, source text or raw model output", async () => {
  shareFixture();

  const serialized = JSON.stringify(await repo.getSharedReport("hash-1"));

  for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("SECRET JD");
  expect(serialized).not.toContain("questionFeedback");
  expect(serialized).not.toContain("nextSteps");
});

test("getSharedReport returns null for an unknown token", async () => {
  shareFixture();

  expect(await repo.getSharedReport("hash-nope")).toBeNull();
});

test("getSharedReport returns null once the share is revoked", async () => {
  shareFixture({ revokedAt: new Date() });

  expect(await repo.getSharedReport("hash-1")).toBeNull();
});

test("getSharedReport returns null while the session is not completed", async () => {
  shareFixture({ status: "generating_report" });

  expect(await repo.getSharedReport("hash-1")).toBeNull();
});

test("getSharedReport returns null once the session is soft-deleted", async () => {
  shareFixture({ deletedAt: new Date() });

  expect(await repo.getSharedReport("hash-1")).toBeNull();
});

test("getSharedReport returns null when the report has not been built", async () => {
  shareFixture();
  sessions.get("s1")!.report = null;

  expect(await repo.getSharedReport("hash-1")).toBeNull();
});

test("upsertReportShare regenerating replaces the token, so the old link stops resolving", async () => {
  shareFixture();

  await repo.upsertReportShare("s1", "hash-2");

  expect(await repo.getSharedReport("hash-1")).toBeNull();
  expect(await repo.getSharedReport("hash-2")).not.toBeNull();
  expect(shares).toHaveLength(1);
});

test("upsertReportShare re-arms a revoked share rather than leaving it dead", async () => {
  shareFixture({ revokedAt: new Date() });

  await repo.upsertReportShare("s1", "hash-2");

  expect(await repo.getSharedReport("hash-2")).not.toBeNull();
});

test("revokeReportShare kills the link for its owner, once", async () => {
  shareFixture();

  expect(await repo.revokeReportShare("s1", OWNER)).toBe(true);
  expect(await repo.getSharedReport("hash-1")).toBeNull();
  expect(await repo.revokeReportShare("s1", OWNER)).toBe(false);
});

test("revokeReportShare refuses another user's session and leaves the link live", async () => {
  shareFixture();

  expect(await repo.revokeReportShare("s1", "user-2")).toBe(false);
  expect(await repo.getSharedReport("hash-1")).not.toBeNull();
});
