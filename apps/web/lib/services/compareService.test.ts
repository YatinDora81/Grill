import { beforeEach, expect, mock, test } from "bun:test";
import type { AnswerScores, MetricDelta } from "@repo/types";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

interface TurnRow {
  turnIndex: number;
  question: string;
  transcript: string | null;
  answerScores: unknown;
}

interface ReportRow {
  overallScore: number;
  categoryScores: unknown;
  deliveryMetrics: unknown;
}

interface SessionRow {
  id: string;
  retryOfId: string | null;
}

interface ParentRow {
  id: string;
  name: string | null;
  createdAt: Date;
  report: ReportRow | null;
}

let session: SessionRow | null;
let parent: ParentRow | null;
let nowReport: ReportRow | null;
let turnsBySession: Record<string, TurnRow[]>;

const RUBRIC_KEYS = ["relevance", "correctness", "structure", "depth", "filler"] as const;

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    session && userId === "u1" && session.id === id ? session : null,
  getRetryParent: async () => parent,
  getReportBySession: async () => nowReport,
  getTurns: async (sessionId: string) => turnsBySession[sessionId] ?? [],
  rubricMean: (value: unknown) => {
    const s = value as AnswerScores | null;
    if (!s || RUBRIC_KEYS.some((k) => typeof s[k] !== "number")) return null;
    return (s.relevance + s.correctness + s.structure + s.depth + s.filler) / 5;
  },
}));

const { compareSessions, deliveryDeltas } = await import("./compareService");

const scores = (n: number): AnswerScores => ({
  relevance: n,
  correctness: n,
  structure: n,
  depth: n,
  filler: n,
});

function turn(turnIndex: number, question: string, transcript: string | null, n = 6): TurnRow {
  return { turnIndex, question, transcript, answerScores: transcript ? scores(n) : null };
}

function report(overall: number, extra: Partial<ReportRow> = {}): ReportRow {
  return {
    overallScore: overall,
    categoryScores: { technical: overall, communication: overall, problem_solving: overall },
    deliveryMetrics: { wpm: 140, avg_pause_ms: 200, filler_count: 10 },
    ...extra,
  };
}

const byKey = (deltas: MetricDelta[], key: string) => deltas.find((d) => d.key === key)!;

beforeEach(() => {
  session = { id: "s2", retryOfId: "s1" };
  parent = {
    id: "s1",
    name: "First go",
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    report: report(58),
  };
  nowReport = report(70);
  turnsBySession = {
    s1: [turn(0, "Why Postgres?", "we picked it because I knew it", 5)],
    s2: [turn(0, "Why Postgres?", "we picked it because it fit the write pattern", 8)],
  };
});

test("a session that is not a retry has nothing to compare", async () => {
  session = { id: "s2", retryOfId: null };

  expect(await compareSessions("u1", "s2")).toBeNull();
});

test("another user's session never reaches the comparison", async () => {
  expect(await compareSessions("someone-else", "s2")).toBeNull();
});

test("a soft-deleted or unreachable parent hides the section rather than erroring", async () => {
  parent = null;

  expect(await compareSessions("u1", "s2")).toBeNull();
});

test("an unscored parent yields null — half a comparison reads as a zero", async () => {
  parent = { ...parent!, report: null };

  expect(await compareSessions("u1", "s2")).toBeNull();
});

test("an unscored current run yields null too", async () => {
  nowReport = null;

  expect(await compareSessions("u1", "s2")).toBeNull();
});

test("overall and category deltas are signed from then to now", async () => {
  const c = (await compareSessions("u1", "s2"))!;

  expect(c.overall).toEqual({
    key: "overall",
    label: "Overall",
    then: 58,
    now: 70,
    delta: 12,
    unit: "",
    better: "up",
  });
  expect(c.categories.map((d) => d.delta)).toEqual([12, 12, 12]);
  expect(c.parent_session_id).toBe("s1");
  expect(c.parent_name).toBe("First go");
  expect(c.parent_date).toBe("2026-08-01T09:00:00.000Z");
});

test("a category missing from an old report reads as not measured, not as zero", async () => {
  parent = { ...parent!, report: report(58, { categoryScores: { technical: 50 } }) };

  const c = (await compareSessions("u1", "s2"))!;

  expect(c.categories.map((d) => [d.then, d.delta])).toEqual([
    [50, 20],
    [null, null],
    [null, null],
  ]);
});

test("a paired turn carries both transcripts, both rubric means and a diff", async () => {
  const c = (await compareSessions("u1", "s2"))!;

  expect(c.turns).toHaveLength(1);
  const t = c.turns[0]!;
  expect(t.turn_index).toBe(0);
  expect(t.then_mean).toBe(5);
  expect(t.now_mean).toBe(8);
  expect(t.then_transcript).toBe("we picked it because I knew it");
  expect(t.diff.filter((d) => d.op === "add").map((d) => d.text)).toEqual([
    "fit the write pattern",
  ]);
  expect(t.diff.filter((d) => d.op === "del").map((d) => d.text)).toEqual(["I knew"]);
});

test("a turn whose question text differs is skipped rather than diffed against the wrong answer", async () => {
  turnsBySession.s1 = [turn(0, "Why MySQL?", "a completely different answer")];

  const c = (await compareSessions("u1", "s2"))!;

  expect(c.turns).toEqual([]);
});

test("a turn only one run answered is skipped", async () => {
  turnsBySession.s2 = [turn(0, "Why Postgres?", null)];

  const c = (await compareSessions("u1", "s2"))!;

  expect(c.turns).toEqual([]);
});

test("a turn the parent never reached is skipped, and the rest still pair up", async () => {
  turnsBySession.s2 = [
    turn(0, "Why Postgres?", "we picked it because it fit the write pattern", 8),
    turn(1, "Tell me about a failure", "the migration dropped writes for a minute", 7),
  ];

  const c = (await compareSessions("u1", "s2"))!;

  expect(c.turns.map((t) => t.turn_index)).toEqual([0]);
});

test("an answer scored on one run only keeps its transcript but not an invented mean", async () => {
  turnsBySession.s1 = [
    { turnIndex: 0, question: "Why Postgres?", transcript: "we picked it", answerScores: null },
  ];

  const c = (await compareSessions("u1", "s2"))!;

  expect(c.turns[0]!.then_mean).toBeNull();
  expect(c.turns[0]!.now_mean).toBe(8);
});

test("comparing a pre-feature parent to a fully measured retry invents no deltas", async () => {
  parent = {
    ...parent!,
    report: report(58, { deliveryMetrics: { wpm: 148, filler_count: 12 } }),
  };
  nowReport = report(70, {
    deliveryMetrics: {
      wpm: 152,
      avg_pause_ms: 240,
      filler_count: 5,
      on_camera_pct: 71.4,
      smile_pct: 9,
      head_motion_dps: 4.1,
      camera_turns: 3,
      jitter_local: 0.014,
    },
  });

  const c = (await compareSessions("u1", "s2"))!;

  expect(byKey(c.delivery, "filler_count").delta).toBe(-7);
  expect(byKey(c.delivery, "wpm").delta).toBe(4);
  for (const key of [
    "avg_pause_ms",
    "on_camera_pct",
    "smile_pct",
    "head_motion_dps",
    "jitter_local",
  ]) {
    expect(byKey(c.delivery, key).then).toBeNull();
    expect(byKey(c.delivery, key).delta).toBeNull();
  }
});

test("a metric measured on one run only has no delta", () => {
  const deltas = deliveryDeltas(
    { wpm: 140, filler_count: 8, pitch_variation: 20 },
    { wpm: 150, filler_count: 5, pitch_variation: null },
  );

  expect(byKey(deltas, "pitch_variation")).toEqual({
    key: "pitch_variation",
    label: "Pitch variation",
    then: 20,
    now: null,
    delta: null,
    unit: " Hz",
    better: "up",
  });
  expect(byKey(deltas, "filler_count").delta).toBe(-3);
  expect(byKey(deltas, "wpm").delta).toBe(10);
});

test("a typed run's sentinel zero pace is absence, not a collapse in pace", () => {
  const deltas = deliveryDeltas({ wpm: 148, avg_pause_ms: 320 }, { wpm: 0, avg_pause_ms: 0 });

  expect(byKey(deltas, "wpm").now).toBeNull();
  expect(byKey(deltas, "wpm").delta).toBeNull();
  expect(byKey(deltas, "avg_pause_ms").delta).toBeNull();
});

test("a filler count of zero is a real measurement and still produces a delta", () => {
  const deltas = deliveryDeltas({ filler_count: 9 }, { filler_count: 0 });

  expect(byKey(deltas, "filler_count").now).toBe(0);
  expect(byKey(deltas, "filler_count").delta).toBe(-9);
});

test("a key the older report never carried is not a run that scored zero on it", () => {
  const deltas = deliveryDeltas(
    { wpm: 140, pitch_variation: 20 },
    { wpm: 150, pitch_variation: 24, filler_count: 4, avg_pause_ms: 260 },
  );

  expect(byKey(deltas, "filler_count")).toMatchObject({ then: null, now: 4, delta: null });
  expect(byKey(deltas, "avg_pause_ms")).toMatchObject({ then: null, now: 260, delta: null });
  expect(byKey(deltas, "pitch_variation").delta).toBe(4);
});

test("a report row missing pace and fillers entirely compares as unmeasured on every one", () => {
  const deltas = deliveryDeltas({}, { wpm: 152, avg_pause_ms: 240, filler_count: 6 });

  for (const key of ["wpm", "avg_pause_ms", "filler_count"]) {
    expect(byKey(deltas, key).then).toBeNull();
    expect(byKey(deltas, key).delta).toBeNull();
  }
  expect(byKey(deltas, "filler_count").now).toBe(6);
});

test("metrics absent from both old reports are null on both sides, never zero", () => {
  const deltas = deliveryDeltas({ wpm: 140 }, { wpm: 150 });

  for (const key of [
    "avg_pause_ms",
    "filler_count",
    "jitter_local",
    "hnr_db",
    "on_camera_pct",
    "smile_pct",
    "uptalk_pct",
  ]) {
    expect(byKey(deltas, key).then).toBeNull();
    expect(byKey(deltas, key).now).toBeNull();
    expect(byKey(deltas, key).delta).toBeNull();
  }
});

test("jitter and shimmer are compared in the percent the report shows them in", () => {
  const deltas = deliveryDeltas(
    { jitter_local: 0.021, shimmer_local: 0.064 },
    { jitter_local: 0.014, shimmer_local: 0.052 },
  );

  expect(byKey(deltas, "jitter_local")).toMatchObject({
    then: 2.1,
    now: 1.4,
    delta: -0.7,
    unit: "%",
  });
  expect(byKey(deltas, "shimmer_local")).toMatchObject({ then: 6.4, now: 5.2, delta: -1.2 });
});

test("every metric declares which direction is an improvement", () => {
  const deltas = deliveryDeltas({}, {});
  const direction = Object.fromEntries(deltas.map((d) => [d.key, d.better]));

  expect(direction).toEqual({
    wpm: "none",
    avg_pause_ms: "down",
    filler_count: "down",
    pitch_variation: "up",
    energy: "up",
    mean_pitch_hz: "none",
    jitter_local: "down",
    shimmer_local: "down",
    hnr_db: "up",
    uptalk_pct: "down",
    on_camera_pct: "up",
    smile_pct: "up",
    head_motion_dps: "down",
  });
});

test("a delivery column that is not an object at all still yields a full row set", () => {
  const deltas = deliveryDeltas("not json", null);

  expect(deltas).toHaveLength(13);
  expect(byKey(deltas, "pitch_variation").then).toBeNull();
});
