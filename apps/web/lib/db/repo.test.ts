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

interface CardRow extends Record<string, unknown> {
  id: string;
  userId: string;
  question: string;
  questionType: string;
  questionHash: string;
  sourceTurnId: string | null;
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: Date;
  lastGrade: number | null;
  bestTranscript: string | null;
  bestMean: number | null;
  suspendedAt: Date | null;
  createdAt: Date;
}

interface ReviewRow extends Record<string, unknown> {
  id: string;
  cardId: string;
  userId: string;
  grade: number;
  transcript: string | null;
  answerScores: unknown;
  reviewedAt: Date;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string | null;
  timezone: string | null;
  emailDigest: boolean;
  lastDigestAt: Date | null;
}

interface TurnRow extends Record<string, unknown> {
  id: string;
  sessionId: string;
  question: string;
  questionType: string;
  transcript: string | null;
  answerScores: unknown;
  createdAt: Date;
}

type Order = Record<string, unknown> | Record<string, unknown>[];

interface FindArgs {
  where?: Record<string, unknown>;
  orderBy?: Order;
  take?: number;
  select?: Select;
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
}

function whereMatches(row: Record<string, unknown>, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((c) => whereMatches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (cond && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      const nullish = value === null || value === undefined;
      if ("lt" in c && (nullish || cmp(value, c.lt) >= 0)) return false;
      if ("lte" in c && (nullish || cmp(value, c.lte) > 0)) return false;
      if ("gt" in c && (nullish || cmp(value, c.gt) <= 0)) return false;
      if ("gte" in c && (nullish || cmp(value, c.gte) < 0)) return false;
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
      if ("not" in c && c.not === null && nullish) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function sortBy<T extends Record<string, unknown>>(rows: T[], orderBy?: Order): T[] {
  if (!orderBy) return rows;
  const rules = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      for (const [field, spec] of Object.entries(rule)) {
        const dir = typeof spec === "string" ? spec : String((spec as { sort: string }).sort);
        const nulls =
          typeof spec === "string" ? "last" : ((spec as { nulls?: string }).nulls ?? "last");
        const av = a[field];
        const bv = b[field];
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) continue;
          return aNull === (nulls === "first") ? -1 : 1;
        }
        const d = cmp(av, bv);
        if (d !== 0) return dir === "desc" ? -d : d;
      }
    }
    return 0;
  });
}

function sessionGate(sessionId: string, gate?: Record<string, unknown>): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (!gate) return true;
  if (gate.userId !== undefined && session.userId !== gate.userId) return false;
  if (gate.deletedAt === null && session.deletedAt !== null) return false;
  return true;
}

let sessions: Map<string, SessionRow>;
let shares: ShareRow[];
let sessionQueries: string[];
let sessionListQueries: Record<string, unknown>[];
let cards: CardRow[];
let reviews: ReviewRow[];
let users: UserRow[];
let turns: TurnRow[];
let turnUpdates: Record<string, unknown>[];
let reportWrites: Record<string, unknown>[];
let briefs: Record<string, unknown>[];
let briefWrites: Record<string, unknown>[];

mock.module("server-only", () => ({}));

const JSON_NULL = Symbol("JsonNull");

function makeCard(data: Record<string, unknown>): CardRow {
  const now = new Date();
  const row: CardRow = {
    id: `card-${cards.length + 1}`,
    userId: String(data.userId),
    question: String(data.question),
    questionType: String(data.questionType),
    questionHash: String(data.questionHash),
    sourceTurnId: (data.sourceTurnId as string | null) ?? null,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: now,
    lastGrade: null,
    bestTranscript: (data.bestTranscript as string | null) ?? null,
    bestMean: (data.bestMean as number | null) ?? null,
    suspendedAt: null,
    createdAt: now,
  };
  cards.push(row);
  return row;
}

const db: Record<string, unknown> = {
  session: {
    findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Select }) => {
      sessionQueries.push(String(where.id));
      const row = sessions.get(String(where.id));
      if (!row) return null;
      if (where.userId !== undefined && row.userId !== where.userId) return null;
      if (where.deletedAt === null && row.deletedAt !== null) return null;
      return project(row, select);
    },
    findMany: async ({ where, orderBy, take, select }: FindArgs) => {
      sessionListQueries.push(where ?? {});
      let rows = [...sessions.values()].filter((s) => whereMatches(s, where));
      rows = sortBy(rows, orderBy);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((s) => project(s, select));
    },
    update: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = sessions.get(String(where.id));
      if (row) Object.assign(row, data);
      return row ?? null;
    },
  },
  reportShare: {
    findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Select }) => {
      const share = shares.find((s) =>
        where.tokenHash !== undefined
          ? s.tokenHash === where.tokenHash
          : s.sessionId === where.sessionId,
      );
      if (!share) return null;
      if (where.revokedAt === null && share.revokedAt !== null) return null;
      const gate = (where.session ?? {}) as Record<string, unknown>;
      const session = sessions.get(share.sessionId);
      if (!session) return null;
      if (gate.userId !== undefined && session.userId !== gate.userId) return null;
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

  turn: {
    findMany: async ({ where, orderBy, take, select }: FindArgs) => {
      const { session: gate, ...rest } = (where ?? {}) as Record<string, unknown>;
      let rows = turns.filter(
        (t) =>
          sessionGate(t.sessionId, gate as Record<string, unknown> | undefined) &&
          whereMatches(t, rest),
      );
      rows = sortBy(rows, orderBy);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((t) => project(t, select));
    },
    update: async ({ data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      turnUpdates.push(data);
      return data;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = turns.filter((t) => whereMatches(t, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  },

  report: {
    upsert: async ({
      create,
      update,
    }: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      reportWrites.push({ create, update });
      return create;
    },
  },

  drillCard: {
    findUnique: async ({ where, select }: FindArgs) => {
      const key = where?.userId_questionHash as { userId: string; questionHash: string };
      const row = cards.find((c) => c.userId === key.userId && c.questionHash === key.questionHash);
      return row ? project(row, select) : null;
    },
    findFirst: async ({ where, select }: FindArgs) => {
      const row = cards.find((c) => whereMatches(c, where));
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, orderBy, take, select }: FindArgs) => {
      let rows = cards.filter((c) => whereMatches(c, where));
      rows = sortBy(rows, orderBy);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((c) => project(c, select));
    },
    count: async ({ where }: FindArgs) => cards.filter((c) => whereMatches(c, where)).length,
    upsert: async ({
      where,
      create,
      update,
      select,
    }: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select?: Select;
    }) => {
      const key = where.userId_questionHash as { userId: string; questionHash: string };
      const existing = cards.find(
        (c) => c.userId === key.userId && c.questionHash === key.questionHash,
      );
      const row = existing ?? makeCard(create);
      if (existing) Object.assign(existing, update);
      return project(row, select);
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = cards.find((c) => c.id === where.id);
      if (row) Object.assign(row, data);
      return row ?? null;
    },
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = cards.filter((c) => whereMatches(c, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  },

  drillReview: {
    findMany: async ({ where, orderBy, take, select }: FindArgs) => {
      let rows = reviews.filter((r) => whereMatches(r, where));
      rows = sortBy(rows, orderBy);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows.map((r) => project(r, select));
    },
    count: async ({ where }: FindArgs) => reviews.filter((r) => whereMatches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: ReviewRow = {
        id: `rev-${reviews.length + 1}`,
        cardId: String(data.cardId),
        userId: String(data.userId),
        grade: Number(data.grade),
        transcript: (data.transcript as string | null) ?? null,
        answerScores: data.answerScores,
        reviewedAt: new Date(),
      };
      reviews.push(row);
      return row;
    },
  },

  user: {
    findMany: async ({ where, orderBy, take, select }: FindArgs) => {
      const { drillCards: relation, ...scalar } = (where ?? {}) as Record<string, unknown>;
      const some = (relation as { some?: Record<string, unknown> } | undefined)?.some;
      let rows = users.filter(
        (u) =>
          whereMatches(u, scalar) &&
          (!some || cards.some((c) => c.userId === u.id && whereMatches(c, some))),
      );
      rows = sortBy(rows, orderBy);
      if (take !== undefined) rows = rows.slice(0, take);

      const sel = (select ?? {}) as Record<string, unknown>;
      const listed = sel.drillCards as FindArgs | undefined;
      const counted = (
        sel._count as { select?: { drillCards?: { where?: Record<string, unknown> } } } | undefined
      )?.select?.drillCards;

      return rows.map((u) => {
        const mine = cards.filter((c) => c.userId === u.id);
        const shown = listed
          ? sortBy(
              mine.filter((c) => whereMatches(c, listed.where)),
              listed.orderBy,
            ).slice(0, listed.take ?? mine.length)
          : [];
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          timezone: u.timezone,
          drillCards: shown.map((c) => ({ question: c.question })),
          _count: {
            drillCards: counted ? mine.filter((c) => whereMatches(c, counted.where)).length : 0,
          },
        };
      });
    },
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = users.filter((u) => whereMatches(u, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  },

  companyBrief: {
    findUnique: async ({ where }: FindArgs) => {
      const key = where?.companyKey_roleKey as { companyKey: string; roleKey: string };
      return (
        briefs.find((b) => b.companyKey === key.companyKey && b.roleKey === key.roleKey) ?? null
      );
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
      briefWrites.push({ where, create, update });
      const key = where.companyKey_roleKey as { companyKey: string; roleKey: string };
      const existing = briefs.find(
        (b) => b.companyKey === key.companyKey && b.roleKey === key.roleKey,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { ...create } as Record<string, unknown>;
      briefs.push(row);
      return row;
    },
  },
};

db.$transaction = async (arg: unknown) =>
  typeof arg === "function"
    ? (arg as (tx: unknown) => Promise<unknown>)(db)
    : Promise.all(arg as Promise<unknown>[]);

mock.module("@repo/db", () => ({ Prisma: { JsonNull: JSON_NULL }, prisma: db }));

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
    starBreakdown: [
      {
        turn_index: 2,
        basis: "time",
        segments: [{ label: "S", start: 0, end: 9, text: "I said um a lot" }],
        share: { S: 90, T: 0, A: 10, R: 0, other: 0 },
        missing: ["R"],
        note: "Two thirds of this answer is scene-setting.",
      },
    ],
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
  sessionListQueries = [];
  cards = [];
  reviews = [];
  users = [];
  turns = [];
  turnUpdates = [];
  reportWrites = [];
  briefs = [];
  briefWrites = [];
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

test("getRetriesOf counts the runs that re-did a session and names the newest of them", async () => {
  chain(["v1", "v2"], [58, 64]);
  sessions.set(
    "v2b",
    makeSession({
      id: "v2b",
      retryOfId: "v1",
      createdAt: new Date(Date.UTC(2026, 0, 9)),
      report: makeReport({ overallScore: 71 }),
    }),
  );

  const retries = await repo.getRetriesOf("v1", OWNER);

  expect(retries).toEqual({
    count: 2,
    latest: {
      id: "v2b",
      name: "Interview v2b",
      overallScore: 71,
      createdAt: new Date(Date.UTC(2026, 0, 9)),
    },
  });
  expect(sessionListQueries).toHaveLength(1);
});

test("getRetriesOf returns null for a session nobody has re-run", async () => {
  chain(["v1", "v2"], [58, 64]);

  expect(await repo.getRetriesOf("v2", OWNER)).toBeNull();
});

test("getRetriesOf counts direct retries only, not a retry of a retry", async () => {
  chain(["v1", "v2", "v3"], [58, 64, 72]);

  const retries = await repo.getRetriesOf("v1", OWNER);

  expect(retries!.count).toBe(1);
  expect(retries!.latest.id).toBe("v2");
});

test("getRetriesOf leaves the latest score null while that retry's report is still building", async () => {
  chain(["v1", "v2"], [58, null]);

  expect((await repo.getRetriesOf("v1", OWNER))!.latest.overallScore).toBeNull();
});

test("getRetriesOf ignores a soft-deleted retry and another user's", async () => {
  chain(["v1", "v2"], [58, 64]);
  sessions.get("v2")!.deletedAt = new Date();
  sessions.set("v2b", makeSession({ id: "v2b", retryOfId: "v1", userId: "user-2" }));

  expect(await repo.getRetriesOf("v1", OWNER)).toBeNull();
});

test("getRetriesOf is empty for another user's session, retries and all", async () => {
  chain(["v1", "v2"], [58, 64]);

  expect(await repo.getRetriesOf("v1", "user-2")).toBeNull();
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
      "starBreakdown",
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

test("getSharedReport shares the STAR proportions and blanks the sentences behind them", async () => {
  shareFixture();

  const bars = (await repo.getSharedReport("hash-1"))!.starBreakdown as Record<string, unknown>[];

  expect(bars).toHaveLength(1);
  expect(bars[0]!.share).toEqual({ S: 90, T: 0, A: 10, R: 0, other: 0 });
  expect(bars[0]!.missing).toEqual(["R"]);
  expect(bars[0]!.segments).toEqual([{ label: "S", start: 0, end: 9, text: "" }]);
});

test("getSharedReport hands a report built before STAR an empty bar list, not a null column", async () => {
  shareFixture();
  sessions.get("s1")!.report!.starBreakdown = null;

  expect((await repo.getSharedReport("hash-1"))!.starBreakdown).toEqual([]);
});

test("getSharedReport survives a malformed STAR column rather than taking the link down", async () => {
  shareFixture();
  sessions.get("s1")!.report!.starBreakdown = { turn_index: 2 };

  expect((await repo.getSharedReport("hash-1"))!.starBreakdown).toEqual([]);
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

test("hasLiveReportShare tells the owner a link is live, so the report can offer Revoke", async () => {
  shareFixture();

  expect(await repo.hasLiveReportShare("s1", OWNER)).toBe(true);
});

test("hasLiveReportShare is false once the link is revoked", async () => {
  shareFixture();

  await repo.revokeReportShare("s1", OWNER);

  expect(await repo.hasLiveReportShare("s1", OWNER)).toBe(false);
});

test("hasLiveReportShare is false for a session that was never shared", async () => {
  shareFixture();

  expect(await repo.hasLiveReportShare("s2", OWNER)).toBe(false);
});

test("hasLiveReportShare refuses another user and a soft-deleted session", async () => {
  shareFixture();

  expect(await repo.hasLiveReportShare("s1", "user-2")).toBe(false);

  sessions.get("s1")!.deletedAt = new Date();

  expect(await repo.hasLiveReportShare("s1", OWNER)).toBe(false);
});

const RUBRIC = { relevance: 8, correctness: 7, structure: 6, depth: 5, filler: 9 };

test("rubricMean averages all five keys, treating filler as already higher-is-better", () => {
  expect(repo.rubricMean(RUBRIC)).toBe(7);
});

test("rubricMean rejects anything that is not a whole rubric rather than returning NaN", () => {
  expect(repo.rubricMean({ ...RUBRIC, depth: undefined })).toBeNull();
  expect(repo.rubricMean({ relevance: 8 })).toBeNull();
  expect(repo.rubricMean({ ...RUBRIC, filler: "9" })).toBeNull();
  expect(repo.rubricMean(null)).toBeNull();
  expect(repo.rubricMean(undefined)).toBeNull();
  expect(repo.rubricMean("scored")).toBeNull();
});

function turn(over: Partial<TurnRow> & { id: string }): TurnRow {
  const row: TurnRow = {
    sessionId: "s1",
    question: `Question ${over.id}`,
    questionType: "technical",
    transcript: "I said um a lot",
    answerScores: RUBRIC,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
  turns.push(row);
  return row;
}

test("listWeakTurns ranks worst first and drops a half-written score instead of ranking NaN", async () => {
  sessions.set("s1", makeSession({ id: "s1" }));
  turn({ id: "ok", answerScores: RUBRIC });
  turn({ id: "worst", answerScores: { ...RUBRIC, relevance: 1, correctness: 1 } });
  turn({ id: "half", answerScores: { relevance: 2 } });
  turn({ id: "unscored", answerScores: null });

  const weak = await repo.listWeakTurns(OWNER);

  expect(weak.map((w) => w.question)).toEqual(["Question worst", "Question ok"]);
});

test("listWeakTurns ignores a soft-deleted interview's answers", async () => {
  sessions.set("s1", makeSession({ id: "s1", deletedAt: new Date() }));
  turn({ id: "ok" });

  expect(await repo.listWeakTurns(OWNER)).toEqual([]);
});

test("listWeakTurns keeps boards and editors out of the pool a spoken interview draws from", async () => {
  sessions.set("s1", makeSession({ id: "s1" }));
  turn({ id: "spoken", answerScores: { ...RUBRIC, relevance: 3 } });
  turn({
    id: "board",
    answerScores: { ...RUBRIC, relevance: 1 },
    designReview: { summary: "one primary, no replica" },
  });
  turn({
    id: "editor",
    answerScores: { ...RUBRIC, relevance: 2 },
    codeSubmission: { language: "python" },
  });

  const weak = await repo.listWeakTurns(OWNER);

  expect(weak.map((w) => w.question)).toEqual(["Question spoken"]);
});

test("purging a session's media clears the design keys too, so nothing signs a deleted board", async () => {
  sessions.set("s1", makeSession({ id: "s1" }));
  const spoken = turn({ id: "spoken", audioKey: "audio/s1/turn_0.webm" });
  const board = turn({
    id: "board",
    audioKey: null,
    designKey: "design/s1/turn_1.excalidraw",
    designImageKey: "design/s1/turn_1.png",
  });

  await repo.markAudioPurged("s1");

  expect(spoken.audioKey).toBeNull();
  expect(board.designKey).toBeNull();
  expect(board.designImageKey).toBeNull();
  expect(sessions.get("s1")!.audioPurgedAt).toBeInstanceOf(Date);
});

const DAY_MS = 86_400_000;
const KOLKATA = "Asia/Kolkata";

function at(daysAgo: number, hourUtc: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

function kolkataKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

test("dayKeyIn answers in the user's calendar, not the server's", () => {
  const late = new Date("2026-03-01T20:30:00.000Z");

  expect(repo.dayKeyIn(late, KOLKATA)).toBe("2026-03-02");
  expect(repo.dayKeyIn(late, "UTC")).toBe("2026-03-01");
});

test("dayKeyIn falls back to UTC on an unusable zone instead of throwing", () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args[0]);
  try {
    expect(repo.dayKeyIn(new Date("2026-03-01T20:30:00.000Z"), "Mars/Olympus")).toBe("2026-03-01");
  } finally {
    console.warn = warn;
  }
  expect(String(warnings[0])).toContain("[repo]");
});

function review(over: Partial<ReviewRow> & { id: string }): ReviewRow {
  const row: ReviewRow = {
    cardId: "card-1",
    userId: OWNER,
    grade: 5,
    transcript: null,
    answerScores: null,
    reviewedAt: at(1, 12),
    ...over,
  };
  reviews.push(row);
  return row;
}

test("listReviewDays collapses a day's reviews into one key, in the user's zone", async () => {
  const evening = at(10, 18);
  const later = at(10, 19);
  review({ id: "r1", reviewedAt: evening });
  review({ id: "r2", reviewedAt: new Date(evening.getTime() + 60_000) });
  review({ id: "r3", reviewedAt: later });

  const days = await repo.listReviewDays(OWNER, KOLKATA);

  expect(kolkataKey(evening)).not.toBe(kolkataKey(later));
  expect([...days].sort()).toEqual([kolkataKey(evening), kolkataKey(later)].sort());
});

test("listReviewDays ignores another user's drilling and anything before the window", async () => {
  review({ id: "mine", reviewedAt: at(2, 12) });
  review({ id: "theirs", userId: "user-2", reviewedAt: at(3, 12) });
  review({ id: "ancient", reviewedAt: at(500, 12) });

  const days = await repo.listReviewDays(OWNER, "UTC");

  expect([...days]).toEqual([repo.dayKeyIn(at(2, 12), "UTC")]);
});

test("countDrillReviewsSince counts only this user, only since the moment given", async () => {
  review({ id: "today", reviewedAt: at(0, 6) });
  review({ id: "yesterday", reviewedAt: at(1, 6) });
  review({ id: "theirs", userId: "user-2", reviewedAt: at(0, 6) });

  expect(await repo.countDrillReviewsSince(OWNER, at(0, 0))).toBe(1);
});

function card(over: Partial<CardRow> & { id: string }): CardRow {
  const row: CardRow = {
    userId: OWNER,
    question: `Question ${over.id}`,
    questionType: "technical",
    questionHash: `hash-${over.id}`,
    sourceTurnId: null,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: at(1, 0),
    lastGrade: null,
    bestTranscript: null,
    bestMean: null,
    suspendedAt: null,
    createdAt: at(30, 0),
    ...over,
  };
  cards.push(row);
  return row;
}

test("listDueDrillCards hands back the most overdue first, capped at the daily limit", async () => {
  card({ id: "c-newest", dueAt: at(1, 0) });
  card({ id: "c-oldest", dueAt: at(9, 0) });
  card({ id: "c-middle", dueAt: at(5, 0) });
  card({ id: "c-later", dueAt: at(3, 0) });

  const deck = await repo.listDueDrillCards(OWNER, 3);

  expect(deck.map((c) => c.id)).toEqual(["c-oldest", "c-middle", "c-later"]);
});

test("listDueDrillCards breaks a shared due time by creation order, so the deck stops reshuffling", async () => {
  const same = at(2, 0);
  card({ id: "c-second", dueAt: same, createdAt: at(4, 0) });
  card({ id: "c-first", dueAt: same, createdAt: at(9, 0) });

  const deck = await repo.listDueDrillCards(OWNER, 5);

  expect(deck.map((c) => c.id)).toEqual(["c-first", "c-second"]);
});

test("listDueDrillCards hides retired cards, future cards, and other users' decks", async () => {
  card({ id: "due" });
  card({ id: "retired", suspendedAt: new Date() });
  card({ id: "future", dueAt: new Date(Date.now() + DAY_MS) });
  card({ id: "theirs", userId: "user-2" });

  const deck = await repo.listDueDrillCards(OWNER, 10);

  expect(deck.map((c) => c.id)).toEqual(["due"]);
});

test("countDueDrillCards counts the whole backlog, not just the page the deck shows", async () => {
  for (let i = 0; i < 7; i++) card({ id: `c${i}` });
  card({ id: "retired", suspendedAt: new Date() });
  card({ id: "theirs", userId: "user-2" });

  expect(await repo.listDueDrillCards(OWNER, 3)).toHaveLength(3);
  expect(await repo.countDueDrillCards(OWNER)).toBe(7);
});

test("listAheadDrillCards offers the soonest future cards and skips the ones already on screen", async () => {
  const soon = new Date(Date.now() + DAY_MS);
  const later = new Date(Date.now() + 5 * DAY_MS);
  card({ id: "onscreen", dueAt: soon });
  card({ id: "next", dueAt: new Date(Date.now() + 2 * DAY_MS) });
  card({ id: "last", dueAt: later });
  card({ id: "due-now" });
  card({ id: "retired", dueAt: soon, suspendedAt: new Date() });

  const ahead = await repo.listAheadDrillCards(OWNER, 2, ["onscreen"]);

  expect(ahead.map((c) => c.id)).toEqual(["next", "last"]);
});

test("getDrillCard refuses another user's card", async () => {
  card({ id: "mine" });

  expect(await repo.getDrillCard("mine", OWNER)).not.toBeNull();
  expect(await repo.getDrillCard("mine", "user-2")).toBeNull();
});

const SEED = { userId: OWNER, question: "Walk me through a rollback.", questionType: "technical" as const };

test("upsertDrillCard creates once and hashes the question the way a star does", async () => {
  const first = await repo.upsertDrillCard(SEED);
  const second = await repo.upsertDrillCard({ ...SEED, question: "  WALK me through a rollback.  " });

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.id).toBe(first.id);
  expect(cards).toHaveLength(1);
  expect(cards[0]!.questionHash).toBe(repo.questionHash(SEED.question));
});

test("upsertDrillCard leaves an existing card's schedule and retirement alone", async () => {
  const retired = new Date("2026-05-01T00:00:00.000Z");
  const due = new Date("2026-09-09T00:00:00.000Z");
  card({
    id: "existing",
    questionHash: repo.questionHash(SEED.question),
    dueAt: due,
    intervalDays: 21,
    repetitions: 4,
    suspendedAt: retired,
  });

  await repo.upsertDrillCard({ ...SEED, bestTranscript: "a better take", bestMean: 9 });

  const row = cards[0]!;
  expect(row.dueAt).toBe(due);
  expect(row.intervalDays).toBe(21);
  expect(row.repetitions).toBe(4);
  expect(row.suspendedAt).toBe(retired);
});

test("upsertDrillCard raises the best answer only when this one actually beat it", async () => {
  card({ id: "existing", questionHash: repo.questionHash(SEED.question), bestTranscript: "good", bestMean: 6 });

  await repo.upsertDrillCard({ ...SEED, bestTranscript: "worse", bestMean: 4 });
  expect(cards[0]!.bestTranscript).toBe("good");

  await repo.upsertDrillCard({ ...SEED, bestTranscript: "better", bestMean: 8 });
  expect(cards[0]!.bestTranscript).toBe("better");
  expect(cards[0]!.bestMean).toBe(8);
});

test("upsertDrillCard stores a first best answer on a card that had none", async () => {
  await repo.upsertDrillCard({ ...SEED, bestTranscript: "first", bestMean: 5 });

  expect(cards[0]!.bestTranscript).toBe("first");
  expect(cards[0]!.bestMean).toBe(5);
});

test("addDrillCard un-retires the card and pulls it forward, keeping its SM-2 history", async () => {
  card({
    id: "existing",
    questionHash: repo.questionHash(SEED.question),
    dueAt: new Date(Date.now() + 30 * DAY_MS),
    suspendedAt: new Date(),
    repetitions: 3,
    ease: 2.9,
  });

  await repo.addDrillCard(SEED);

  const row = cards[0]!;
  expect(row.suspendedAt).toBeNull();
  expect(row.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(row.repetitions).toBe(3);
  expect(row.ease).toBe(2.9);
});

const SCHEDULE = { ease: 2.6, intervalDays: 6, repetitions: 2, dueAt: new Date("2026-09-01T00:00:00.000Z") };

test("recordDrillReview moves the card and writes the review together", async () => {
  card({ id: "c1" });

  const ok = await repo.recordDrillReview({
    cardId: "c1",
    userId: OWNER,
    grade: 5,
    transcript: "this time with numbers",
    answerScores: RUBRIC,
    schedule: SCHEDULE,
  });

  expect(ok).toBe(true);
  expect(cards[0]!.intervalDays).toBe(6);
  expect(cards[0]!.dueAt).toBe(SCHEDULE.dueAt);
  expect(cards[0]!.lastGrade).toBe(5);
  expect(reviews).toHaveLength(1);
  expect(reviews[0]!.userId).toBe(OWNER);
  expect(reviews[0]!.grade).toBe(5);
});

test("recordDrillReview refuses another user's card and writes neither half", async () => {
  card({ id: "c1", intervalDays: 0 });

  const ok = await repo.recordDrillReview({
    cardId: "c1",
    userId: "user-2",
    grade: 5,
    schedule: SCHEDULE,
  });

  expect(ok).toBe(false);
  expect(cards[0]!.intervalDays).toBe(0);
  expect(reviews).toEqual([]);
});

test("recordDrillReview keeps the better answer on record", async () => {
  card({ id: "c1", bestTranscript: "good", bestMean: 7 });

  await repo.recordDrillReview({
    cardId: "c1",
    userId: OWNER,
    grade: 3,
    schedule: SCHEDULE,
    attempt: { transcript: "worse", mean: 5 },
  });
  expect(cards[0]!.bestTranscript).toBe("good");

  await repo.recordDrillReview({
    cardId: "c1",
    userId: OWNER,
    grade: 5,
    schedule: SCHEDULE,
    attempt: { transcript: "best yet", mean: 9 },
  });
  expect(cards[0]!.bestTranscript).toBe("best yet");
  expect(cards[0]!.bestMean).toBe(9);
});

test("recordDrillReview stores a bare self-grade without inventing a transcript", async () => {
  card({ id: "c1" });

  await repo.recordDrillReview({ cardId: "c1", userId: OWNER, grade: 1, schedule: SCHEDULE });

  expect(reviews[0]!.transcript).toBeNull();
  expect(reviews[0]!.answerScores).toBe(JSON_NULL);
});

test("suspendDrillCard retires a card once, and never someone else's", async () => {
  card({ id: "c1" });

  expect(await repo.suspendDrillCard("c1", "user-2")).toBe(false);
  expect(cards[0]!.suspendedAt).toBeNull();

  expect(await repo.suspendDrillCard("c1", OWNER)).toBe(true);
  expect(await repo.suspendDrillCard("c1", OWNER)).toBe(false);
  expect(await repo.listDueDrillCards(OWNER, 10)).toEqual([]);
});

function user(over: Partial<UserRow> & { id: string }): UserRow {
  const row: UserRow = {
    email: `${over.id}@example.test`,
    name: "Drilling user",
    timezone: KOLKATA,
    emailDigest: true,
    lastDigestAt: null,
    ...over,
  };
  users.push(row);
  return row;
}

const CUTOFF = new Date(Date.now() - 7 * DAY_MS);

test("listDigestCandidates carries the due count and the first question, so the sweep needs no second query", async () => {
  user({ id: "u1" });
  card({ id: "c-old", userId: "u1", dueAt: at(9, 0), question: "Design a rate limiter." });
  card({ id: "c-new", userId: "u1", dueAt: at(1, 0) });

  const [candidate] = await repo.listDigestCandidates(CUTOFF);

  expect(candidate!.id).toBe("u1");
  expect(candidate!.email).toBe("u1@example.test");
  expect(candidate!.timezone).toBe(KOLKATA);
  expect(candidate!.dueCount).toBe(2);
  expect(candidate!.firstDueQuestion).toBe("Design a rate limiter.");
});

test("listDigestCandidates skips opted-out users, empty decks, and anyone mailed this week", async () => {
  user({ id: "opted-out", emailDigest: false });
  card({ id: "c1", userId: "opted-out" });

  user({ id: "nothing-due" });
  card({ id: "c2", userId: "nothing-due", dueAt: new Date(Date.now() + DAY_MS) });

  user({ id: "just-mailed", lastDigestAt: at(2, 0) });
  card({ id: "c3", userId: "just-mailed" });

  user({ id: "retired-only" });
  card({ id: "c4", userId: "retired-only", suspendedAt: new Date() });

  expect(await repo.listDigestCandidates(CUTOFF)).toEqual([]);
});

test("listDigestCandidates puts never-mailed users first, then the longest-waiting", async () => {
  user({ id: "waited-longest", lastDigestAt: at(40, 0) });
  card({ id: "c1", userId: "waited-longest" });
  user({ id: "never-mailed" });
  card({ id: "c2", userId: "never-mailed" });
  user({ id: "waited-less", lastDigestAt: at(9, 0) });
  card({ id: "c3", userId: "waited-less" });

  const order = (await repo.listDigestCandidates(CUTOFF)).map((c) => c.id);

  expect(order).toEqual(["never-mailed", "waited-longest", "waited-less"]);
});

test("listDigestCandidates honours the batch size", async () => {
  for (let i = 0; i < 4; i++) {
    user({ id: `u${i}` });
    card({ id: `c${i}`, userId: `u${i}` });
  }

  expect(await repo.listDigestCandidates(CUTOFF, 2)).toHaveLength(2);
});

test("claimDrillDigest stamps once, so two overlapping sweeps can't both mail", async () => {
  user({ id: "u1" });

  expect(await repo.claimDrillDigest("u1", CUTOFF)).toBe(true);
  expect(await repo.claimDrillDigest("u1", CUTOFF)).toBe(false);
  expect(users[0]!.lastDigestAt).not.toBeNull();
});

test("claimDrillDigest refuses a user who opted out between the sweep and the send", async () => {
  user({ id: "u1", emailDigest: false });

  expect(await repo.claimDrillDigest("u1", CUTOFF)).toBe(false);
});

const REPORT_INPUT = {
  sessionId: "s1",
  overallScore: 64,
  verdict: "Pressed",
  categoryScores: {},
  deliveryMetrics: {},
  strengths: [],
  weaknesses: [],
  bestAnswer: null,
  worstAnswer: null,
  nextSteps: [],
  questionFeedback: [],
  raw: {},
};

test("createReport writes the STAR breakdown, and an empty bar when there was nothing to label", async () => {
  await repo.createReport({ ...REPORT_INPUT, starBreakdown: undefined });
  expect((reportWrites[0]!.create as Record<string, unknown>).starBreakdown).toEqual([]);

  const bars = [{ turn_index: 2, basis: "time" }];
  await repo.createReport({ ...REPORT_INPUT, starBreakdown: bars });
  expect((reportWrites[1]!.update as Record<string, unknown>).starBreakdown).toBe(bars);
});

test("recordAnswer writes camera metrics when they were measured", async () => {
  const cameraMetrics = {
    frames: 240,
    no_face_frames: 3,
    on_camera_pct: 82,
    smile_pct: 11,
    head_motion_dps: 4.2,
    away_segments: [{ start_ms: 1200, end_ms: 2400 }],
    longest_away_ms: 1200,
    sample_hz: 4,
    pose_source: "matrix" as const,
  };

  await repo.recordAnswer("s1", 0, { transcript: "…", answerScores: RUBRIC, cameraMetrics });

  expect(turnUpdates[0]!.cameraMetrics).toBe(cameraMetrics);
});

test("recordAnswer leaves a measured answer's camera metrics alone when a resend carries none", async () => {
  await repo.recordAnswer("s1", 0, { transcript: "…", answerScores: RUBRIC });
  await repo.recordAnswer("s1", 0, { transcript: "…", answerScores: RUBRIC, cameraMetrics: null });

  expect(turnUpdates[0]!.cameraMetrics).toBeUndefined();
  expect(turnUpdates[1]!.cameraMetrics).toBeUndefined();
});

const BRIEF_INPUT = {
  companyKey: "acme",
  roleKey: "",
  company: "Acme Technologies Pvt. Ltd.",
  role: null,
  brief: { what_they_do: "…" },
  grounded: true,
  sources: [{ uri: "https://acme.test", title: "Acme" }],
  raw: { text: "…" },
};

test("upsertCompanyBrief moves createdAt on the update branch, or a refreshed brief reads stale forever", async () => {
  await repo.upsertCompanyBrief(BRIEF_INPUT);
  const stamped = (briefs[0]!.createdAt as Date).getTime();

  await repo.upsertCompanyBrief({ ...BRIEF_INPUT, grounded: false, brief: { what_they_do: "new" } });

  const write = briefWrites[1] as { where: unknown; update: Record<string, unknown> };
  expect(write.where).toEqual({ companyKey_roleKey: { companyKey: "acme", roleKey: "" } });
  expect(write.update.createdAt).toBeInstanceOf(Date);
  expect((briefs[0]!.createdAt as Date).getTime()).toBeGreaterThanOrEqual(stamped);
  expect(briefs).toHaveLength(1);
  expect(briefs[0]!.grounded).toBe(false);
});

test("getCompanyBrief is keyed on the pair, so a role-specific brief never answers a roleless one", async () => {
  await repo.upsertCompanyBrief(BRIEF_INPUT);
  await repo.upsertCompanyBrief({ ...BRIEF_INPUT, roleKey: "backend engineer", role: "Backend engineer" });

  expect(await repo.getCompanyBrief("acme", "")).not.toBeNull();
  expect(await repo.getCompanyBrief("acme", "backend engineer")).not.toBeNull();
  expect(await repo.getCompanyBrief("acme", "data scientist")).toBeNull();
  expect(await repo.getCompanyBrief("globex", "")).toBeNull();
  expect(briefs).toHaveLength(2);
});
