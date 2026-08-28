import { test, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("@/lib/auth", () => ({
  requireUserId: async () => "user-1",
}));

let afterCalls: (() => unknown)[] = [];

mock.module("next/server", () => ({
  NextResponse,
  after: (fn: () => unknown) => {
    afterCalls.push(fn);
  },
}));

let session: { id: string; status: string; reportAttempts: number } | null = null;
let report: { id: string } | null = null;
let statuses: string[] = [];

mock.module("@/lib/db/repo", () => ({
  MAX_REPORT_ATTEMPTS: 5,
  getSession: async () => session,
  getReportBySession: async () => report,
  setStatus: async (_id: string, status: string) => {
    statuses.push(status);
  },
}));

let configured = false;
let published: string[] = [];
let publishFails = false;

mock.module("@/lib/queue/qstash", () => ({
  qstashConfigured: () => configured,
  publishReportBuild: async (sessionId: string) => {
    if (publishFails) throw new Error("qstash said no");
    published.push(sessionId);
  },
}));

let built: string[] = [];

mock.module("@/lib/services/reportQueue", () => ({
  claimAndBuild: async (sessionId: string) => {
    built.push(sessionId);
    return "built";
  },
}));

mock.module("@/lib/services/videoService", () => ({
  VIDEO_FLUSH_GRACE_MS: 0,
}));

const { POST } = await import("./route");

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

const end = () =>
  POST(
    new Request("https://example.test/api/interview/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID }),
    }),
  );

beforeEach(() => {
  session = { id: SESSION_ID, status: "in_progress", reportAttempts: 0 };
  report = null;
  statuses = [];
  afterCalls = [];
  published = [];
  built = [];
  configured = false;
  publishFails = false;
});

test("with no queue configured the build still rides on after(), exactly as before", async () => {
  const res = await end();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    session_id: SESSION_ID,
    report_id: null,
    status: "generating_report",
  });
  expect(statuses).toEqual(["generating_report"]);
  expect(published).toEqual([]);
  expect(afterCalls).toHaveLength(1);

  await afterCalls[0]!();
  expect(built).toEqual([SESSION_ID]);
});

test("with the queue configured the build is published and nothing runs in this invocation", async () => {
  configured = true;

  const res = await end();

  expect(res.status).toBe(200);
  expect(published).toEqual([SESSION_ID]);
  expect(afterCalls).toEqual([]);
  expect(statuses).toEqual(["generating_report"]);
});

test("a queue that refuses the message falls back to after() rather than losing the report", async () => {
  configured = true;
  publishFails = true;

  const res = await end();

  expect(res.status).toBe(200);
  expect(published).toEqual([]);
  expect(afterCalls).toHaveLength(1);

  await afterCalls[0]!();
  expect(built).toEqual([SESSION_ID]);
});

test("a session that already has a report is reconciled, not queued twice", async () => {
  configured = true;
  session = { id: SESSION_ID, status: "generating_report", reportAttempts: 0 };
  report = { id: "report-1" };

  const res = await end();

  expect(await res.json()).toEqual({
    session_id: SESSION_ID,
    report_id: "report-1",
    status: "completed",
  });
  expect(statuses).toEqual(["completed"]);
  expect(published).toEqual([]);
  expect(afterCalls).toEqual([]);
});
