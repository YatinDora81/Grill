import { test, expect, mock, beforeEach } from "bun:test";

/**
 * The sweep's stranded pass.
 *
 * `generating_report` with the attempts spent is the one state no worker can
 * see: claimReportLease and listPendingReportSessions both require
 * `attempts < MAX`, so a build killed before it reached the catch that would
 * have failed it leaves a row whose status still promises a report nobody is
 * building. These pin the ending the sweep now writes for it — including that it
 * is written *last*, so a row stranded while this very sweep was running is
 * closed out today rather than after another day of spinning.
 */

const MAX_REPORT_ATTEMPTS = 5;

type Row = {
  id: string;
  status: string;
  reportAttempts: number;
  errorReason?: string | null;
  /** A lease held by another worker takes the row out of the pending query. */
  leased?: boolean;
  hasReport?: boolean;
};

let rows: Map<string, Row>;
/** Ordered trace of the calls that matter, so "runs last" is checkable. */
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
    row.reportAttempts += 1; // the real UPDATE returns the row post-increment
    return { ...row };
  },
  releaseReportLease: async () => {},
}));

const buildAndSaveReport = mock(async (session: { id: string }) => {
  calls.push(`build:${session.id}`);
});
mock.module("./reportService", () => ({ buildAndSaveReport }));

/** Records the grace it was handed, so the /end-vs-sweep handoff is checkable. */
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
  // The reason is the only thing the candidate ever sees, so it has to say why
  // there is no report rather than just that there isn't one.
  expect(row.errorReason).toContain(String(MAX_REPORT_ATTEMPTS));
  expect(row.errorReason).toMatch(/attempts/i);
});

test("leaves a session that still has attempts left alone", async () => {
  // Nothing is stranded, so nothing may be written: a row mid-retry still has a
  // report coming and failing it out would throw away a working session.
  seed({ id: "s-retrying", status: "generating_report", reportAttempts: MAX_REPORT_ATTEMPTS - 1, leased: true });

  await drainReports(60_000);

  expect(setStatus).not.toHaveBeenCalled();
  expect(rows.get("s-retrying")!.status).toBe("generating_report");
});

test("returns the sweep's outcomes even when the stranded query blows up", async () => {
  seed({ id: "s-ok", status: "generating_report", reportAttempts: 0 });
  strandedThrows = new Error("db is down");

  // Housekeeping must not be able to take the sweep's real work down with it.
  const outcomes = await drainReports(60_000);

  expect(outcomes).toEqual(["built"]);
  expect(listStrandedReportSessions).toHaveBeenCalled();
});

test("closes out a session stranded while this same sweep was running", async () => {
  seed({ id: "s-building", status: "generating_report", reportAttempts: 0 });
  // Held by the /end worker, so the sweep's pending query never sees it. It is
  // one attempt short of the ceiling when the sweep starts — checking for
  // stranded rows up front would find nothing here.
  seed({ id: "s-killed", status: "generating_report", reportAttempts: MAX_REPORT_ATTEMPTS - 1, leased: true });

  buildAndSaveReport.mockImplementation(async (session: { id: string }) => {
    calls.push(`build:${session.id}`);
    // Meanwhile that worker burns the last attempt and is killed mid-flight,
    // never reaching the catch that would have failed the session out.
    Object.assign(rows.get("s-killed")!, { reportAttempts: MAX_REPORT_ATTEMPTS, leased: false });
  });

  await drainReports(60_000);

  expect(rows.get("s-killed")!.status).toBe("error");
  expect(calls.indexOf("listStranded")).toBeGreaterThan(calls.indexOf("build:s-building"));
});

/**
 * The grace has to survive the trip, not just exist.
 *
 * videoService.test.ts proves settleUnfinishedVideos honours a graceMs it is
 * handed. The bug it was written for lived in the wiring: /end passes
 * VIDEO_FLUSH_GRACE_MS to claimAndBuild, which forwards it to the settle. Delete
 * either hop and a live upload is stitched shut mid-flush again — with every
 * assertion in videoService.test.ts still green, because the unit under test
 * there is the one place the bug never was.
 */

test("the /end path forwards its grace to the settle, so a live upload is spared", async () => {
  seed({ id: "s-live", status: "generating_report", reportAttempts: 0 });

  await claimAndBuild("s-live", { videoGraceMs: 120_000 });

  expect(settleCalls).toHaveLength(1);
  expect(settleCalls[0]!.sessionId).toBe("s-live");
  // The whole fix is this value arriving. A dropped forward reads as
  // `{ graceMs: undefined }`, which the settle treats as "no grace" —
  // indistinguishable from the sweep, and the original mid-flush bug exactly.
  expect(settleCalls[0]!.opts).toEqual({ graceMs: 120_000 });
});

test("the sweep passes no grace, so an abandoned upload is still salvaged", async () => {
  seed({ id: "s-swept", status: "generating_report", reportAttempts: 0 });

  await drainReports(60_000);

  const settle = settleCalls.find((c) => c.sessionId === "s-swept");
  expect(settle).toBeDefined();
  // Undefined, not a number: by the time the sweep runs no browser can be
  // writing, and a grace here would leave a dead upload dangling until R2 reaps it.
  expect(settle!.opts.graceMs).toBeUndefined();
});

test("a settle that throws never costs the session its report", async () => {
  seed({ id: "s-settlefail", status: "generating_report", reportAttempts: 0 });
  settleThrows = new Error("R2 down");

  // Housekeeping is best-effort by contract; the report is the point.
  await expect(claimAndBuild("s-settlefail", { videoGraceMs: 120_000 })).resolves.toBe("built");
});
