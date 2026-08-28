import { test, expect, mock, beforeEach } from "bun:test";

const MAX_REPORT_ATTEMPTS = 5;

type Row = {
  id: string;
  status: string;
  reportAttempts: number;
  errorReason?: string | null;
  leased?: boolean;
  hasReport?: boolean;
};

let rows: Map<string, Row>;
let calls: string[];
let strandedThrows: Error | null;

const setStatus = mock(async (id: string, status: string, errorReason?: string) => {
  calls.push(`setStatus:${id}:${status}`);
  const row = rows.get(id);
  if (row) Object.assign(row, { status, errorReason: errorReason ?? null });
});

const listStrandedReportSessions = mock(async () => {
  calls.push("listStranded");
  if (strandedThrows) throw strandedThrows;
  return [...rows.values()]
    .filter((r) => r.status === "generating_report" && r.reportAttempts >= MAX_REPORT_ATTEMPTS && !r.hasReport)
    .map(({ id }) => ({ id }));
});

mock.module("server-only", () => ({}));

mock.module("@/lib/db/repo", () => ({
  MAX_REPORT_ATTEMPTS,
  setStatus,
  listStrandedReportSessions,
  getReportBySession: async (id: string) => (rows.get(id)?.hasReport ? { id: "r" } : null),
  listPendingReportSessions: async () =>
    [...rows.values()]
      .filter(
        (r) => r.status === "generating_report" && r.reportAttempts < MAX_REPORT_ATTEMPTS && !r.hasReport && !r.leased,
      )
      .map(({ id }) => ({ id })),
  claimReportLease: async (id: string) => {
    const row = rows.get(id);
    if (!row || row.status !== "generating_report" || row.reportAttempts >= MAX_REPORT_ATTEMPTS || row.leased) {
      return null;
    }
    row.reportAttempts += 1;
    return { ...row };
  },
  releaseReportLease: async () => {},
}));

const buildAndSaveReport = mock(async (session: { id: string }) => {
  calls.push(`build:${session.id}`);
});
mock.module("./reportService", () => ({ buildAndSaveReport }));

const settleCalls: { sessionId: string; opts: { graceMs?: number } }[] = [];
let settleThrows: Error | null = null;
mock.module("./videoService", () => ({
  settleUnfinishedVideos: async (sessionId: string, opts: { graceMs?: number } = {}) => {
    settleCalls.push({ sessionId, opts });
    if (settleThrows) throw settleThrows;
  },
  VIDEO_FLUSH_GRACE_MS: 120_000,
}));

const { drainReports, claimAndBuild } = await import("./reportQueue");

beforeEach(() => {
  rows = new Map();
  calls = [];
  strandedThrows = null;
  settleCalls.length = 0;
  settleThrows = null;
  setStatus.mockClear();
  listStrandedReportSessions.mockClear();
  buildAndSaveReport.mockImplementation(async (session: { id: string }) => {
    calls.push(`build:${session.id}`);
  });
});

function seed(row: Row) {
  rows.set(row.id, row);
}

test("fails out a session left in generating_report with its attempts spent", async () => {
  seed({ id: "s-stranded", status: "generating_report", reportAttempts: MAX_REPORT_ATTEMPTS });

  await drainReports(60_000);

  const row = rows.get("s-stranded")!;
  expect(row.status).toBe("error");
  expect(row.errorReason).toContain(String(MAX_REPORT_ATTEMPTS));
  expect(row.errorReason).toMatch(/attempts/i);
});

test("leaves a session that still has attempts left alone", async () => {
  seed({ id: "s-retrying", status: "generating_report", reportAttempts: MAX_REPORT_ATTEMPTS - 1, leased: true });

  await drainReports(60_000);

  expect(setStatus).not.toHaveBeenCalled();
  expect(rows.get("s-retrying")!.status).toBe("generating_report");
});

test("returns the sweep's outcomes even when the stranded query blows up", async () => {
  seed({ id: "s-ok", status: "generating_report", reportAttempts: 0 });
  strandedThrows = new Error("db is down");

  const outcomes = await drainReports(60_000);

  expect(outcomes).toEqual(["built"]);
  expect(listStrandedReportSessions).toHaveBeenCalled();
});

test("closes out a session stranded while this same sweep was running", async () => {
  seed({ id: "s-building", status: "generating_report", reportAttempts: 0 });
  seed({ id: "s-killed", status: "generating_report", reportAttempts: MAX_REPORT_ATTEMPTS - 1, leased: true });

  buildAndSaveReport.mockImplementation(async (session: { id: string }) => {
    calls.push(`build:${session.id}`);
    Object.assign(rows.get("s-killed")!, { reportAttempts: MAX_REPORT_ATTEMPTS, leased: false });
  });

  await drainReports(60_000);

  expect(rows.get("s-killed")!.status).toBe("error");
  expect(calls.indexOf("listStranded")).toBeGreaterThan(calls.indexOf("build:s-building"));
});

test("the /end path forwards its grace to the settle, so a live upload is spared", async () => {
  seed({ id: "s-live", status: "generating_report", reportAttempts: 0 });

  await claimAndBuild("s-live", { videoGraceMs: 120_000 });

  expect(settleCalls).toHaveLength(1);
  expect(settleCalls[0]!.sessionId).toBe("s-live");
  expect(settleCalls[0]!.opts).toEqual({ graceMs: 120_000 });
});

test("the sweep passes no grace, so an abandoned upload is still salvaged", async () => {
  seed({ id: "s-swept", status: "generating_report", reportAttempts: 0 });

  await drainReports(60_000);

  const settle = settleCalls.find((c) => c.sessionId === "s-swept");
  expect(settle).toBeDefined();
  expect(settle!.opts.graceMs).toBeUndefined();
});

test("a settle that throws never costs the session its report", async () => {
  seed({ id: "s-settlefail", status: "generating_report", reportAttempts: 0 });
  settleThrows = new Error("R2 down");

  await expect(claimAndBuild("s-settlefail", { videoGraceMs: 120_000 })).resolves.toBe("built");
});
