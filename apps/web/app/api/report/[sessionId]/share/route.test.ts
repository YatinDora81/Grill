import { test, expect, mock, beforeEach } from "bun:test";

type Session = { id: string; userId: string; status: string };

let sessions: Map<string, Session>;
let reports: Set<string>;
let shared: string[];

mock.module("server-only", () => ({}));

mock.module("@/lib/auth", () => ({
  requireUserId: async () => "user-1",
}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";

mock.module("@/lib/rateLimit", () => ({
  rateLimit: () => {},
}));

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) => {
    const session = sessions.get(id);
    return session && session.userId === userId ? session : null;
  },
  getReportBySession: async (id: string) => (reports.has(id) ? { id: `report-${id}` } : null),
  upsertReportShare: async (id: string, tokenHash: string) => {
    shared.push(`${id}:${tokenHash.length}`);
    return { id: "share-1" };
  },
  revokeReportShare: async () => true,
}));

const { POST } = await import("./route");

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const post = (sessionId: string) =>
  POST(new Request("https://example.test/api/report/x/share", { method: "POST" }), {
    params: Promise.resolve({ sessionId }),
  });

beforeEach(() => {
  sessions = new Map([[SESSION_ID, { id: SESSION_ID, userId: "user-1", status: "generating_report" }]]);
  reports = new Set<string>();
  shared = [];
});

test("shares a session whose report exists but whose status never reached completed", async () => {
  reports.add(SESSION_ID);

  const res = await post(SESSION_ID);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string };
  expect(body.url.startsWith("https://example.test/r/")).toBe(true);
  expect(shared).toHaveLength(1);
});

test("refuses a session that has no report yet, whatever its status says", async () => {
  sessions.set(SESSION_ID, { id: SESSION_ID, userId: "user-1", status: "completed" });

  const res = await post(SESSION_ID);

  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("no_report");
  expect(shared).toHaveLength(0);
});

test("does not leak another user's session", async () => {
  sessions.set(SESSION_ID, { id: SESSION_ID, userId: "user-2", status: "completed" });
  reports.add(SESSION_ID);

  const res = await post(SESSION_ID);

  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("unknown_session");
  expect(shared).toHaveLength(0);
});
