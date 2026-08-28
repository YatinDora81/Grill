import { expect, mock, test } from "bun:test";
import type { DeliveryPoint } from "@repo/types";

mock.module("server-only", () => ({}));

mock.module("@/lib/auth", () => ({
  toUserDTO: (u: { id: string; email: string; name: string | null }) => ({
    id: u.id,
    email: u.email,
    name: u.name,
  }),
}));

interface ReportRow {
  overallScore: number;
  sessionId: string;
  deliveryMetrics: unknown;
  session: { createdAt: Date };
}

let reportRows: ReportRow[] = [];
let userTimezone: string | null = null;

mock.module("@/lib/db/repo", () => ({
  getUserById: async () => ({ id: "u1", email: "a@b.c", name: "A", timezone: userTimezone }),
  listUserReportsWithDelivery: async () => reportRows,
  listUserSessions: async () => [],
  countAnsweredTurns: async () => 4,
  listRecentAnswerScores: async () => [],
  getSessionProgress: async () => null,
  listRetryChain: async () => [],
}));

let drill = { streak_days: 0, cards_due: 0 };
const drillZones: (string | null)[] = [];

mock.module("@/lib/services/drillService", () => ({
  drillStats: async (_userId: string, timeZone: string | null) => {
    drillZones.push(timeZone);
    return drill;
  },
}));

const { getDashboardData } = await import("./dashboardService");

function report(sessionId: string, day: string, deliveryMetrics: unknown): ReportRow {
  return {
    overallScore: 70,
    sessionId,
    deliveryMetrics,
    session: { createdAt: new Date(`2026-08-${day}T10:00:00.000Z`) },
  };
}

async function series(rows: ReportRow[]): Promise<DeliveryPoint[]> {
  reportRows = rows;
  return (await getDashboardData("u1")).delivery_series;
}

test("a typed session's sentinel wpm of 0 becomes a gap, not a plotted zero", async () => {
  const points = await series([
    report("s1", "01", { wpm: 148, filler_count: 9 }),
    report("s2", "02", { wpm: 0, filler_count: 4 }),
  ]);

  expect(points.map((p) => p.wpm)).toEqual([148, null]);
  expect(points.map((p) => p.fillers)).toEqual([9, 4]);
});

test("a filler count of 0 stays a measurement", async () => {
  const points = await series([report("s1", "01", { wpm: 132, filler_count: 0 })]);

  expect(points[0]!.fillers).toBe(0);
  expect(points[0]!.wpm).toBe(132);
});

test("wpm that is missing, negative or not a number reads as unmeasured", async () => {
  const points = await series([
    report("s1", "01", { filler_count: 3 }),
    report("s2", "02", { wpm: -12, filler_count: 3 }),
    report("s3", "03", { wpm: "148", filler_count: 3 }),
    report("s4", "04", null),
  ]);

  expect(points.map((p) => p.wpm)).toEqual([null, null, null, null]);
});

test("the drill streak and due count reach the dashboard as counts, zero included", async () => {
  reportRows = [];
  drill = { streak_days: 0, cards_due: 0 };
  const empty = await getDashboardData("u1");
  expect(empty.stats.streak_days).toBe(0);
  expect(empty.stats.cards_due).toBe(0);

  drill = { streak_days: 4, cards_due: 7 };
  const busy = await getDashboardData("u1");
  expect(busy.stats.streak_days).toBe(4);
  expect(busy.stats.cards_due).toBe(7);
});

test("the user's own timezone is what the streak is counted in", async () => {
  reportRows = [];
  drillZones.length = 0;

  userTimezone = "Asia/Kolkata";
  await getDashboardData("u1");
  userTimezone = null;
  await getDashboardData("u1");

  expect(drillZones).toEqual(["Asia/Kolkata", null]);
});
