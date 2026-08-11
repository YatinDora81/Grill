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

mock.module("@/lib/db/repo", () => ({
  getUserById: async () => ({ id: "u1", email: "a@b.c", name: "A" }),
  listUserReportsWithDelivery: async () => reportRows,
  listUserSessions: async () => [],
  countAnsweredTurns: async () => 4,
  listRecentAnswerScores: async () => [],
  getSessionProgress: async () => null,
  listRetryChain: async () => [],
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
