import { test, expect } from "bun:test";

import {
  DEFAULT_EASE,
  MIN_EASE,
  gradeFromScores,
  prevDayKey,
  schedule,
  startOfDayIn,
  streakDays,
  type Sm2State,
} from "./sm2";

const NEW_CARD: Sm2State = { ease: DEFAULT_EASE, intervalDays: 0, repetitions: 0 };
const NOW = new Date("2026-08-26T09:00:00.000Z");

const DAY_MS = 86_400_000;

function run(grades: number[], from: Sm2State = NEW_CARD) {
  let state = from;
  const steps = [];
  for (const g of grades) {
    const next = schedule(state, g, NOW);
    steps.push(next);
    state = { ease: next.ease, intervalDays: next.intervalDays, repetitions: next.repetitions };
  }
  return steps;
}

test("three perfect recalls walk the canonical 1 / 6 / 6×ease progression", () => {
  const steps = run([5, 5, 5]);

  expect(steps.map((s) => s.intervalDays)).toEqual([1, 6, 16]);
  expect(steps.map((s) => s.repetitions)).toEqual([1, 2, 3]);
  expect(steps.map((s) => s.ease)).toEqual([2.6, 2.7, 2.8]);
});

test("a run of grade 4 leaves the ease alone and gives the textbook 1 / 6 / 15", () => {
  const steps = run([4, 4, 4]);
  expect(steps.map((s) => s.intervalDays)).toEqual([1, 6, 15]);
  expect(steps.every((s) => s.ease === DEFAULT_EASE)).toBe(true);
});

test("the interval uses the ease the card arrived with, not the one this review sets", () => {
  const [step] = run([5], { ease: 2, intervalDays: 10, repetitions: 2 });
  expect(step?.intervalDays).toBe(20);
  expect(step?.ease).toBe(2.1);
});

test("a failed grade resets the repetitions and the interval but never the ease", () => {
  const mature: Sm2State = { ease: 2.5, intervalDays: 30, repetitions: 4 };
  const [step] = run([2], mature);

  expect(step?.repetitions).toBe(0);
  expect(step?.intervalDays).toBe(1);
  expect(step?.ease).toBe(2.18);
});

test("grade 3 passes — the lowest grade that keeps the card moving forward", () => {
  const [pass] = run([3], { ease: 2.5, intervalDays: 6, repetitions: 2 });
  expect(pass?.repetitions).toBe(3);
  expect(pass?.intervalDays).toBe(15);

  const [fail] = run([2], { ease: 2.5, intervalDays: 6, repetitions: 2 });
  expect(fail?.repetitions).toBe(0);
});

test("ease never falls below the 1.3 floor, however often the card is blanked", () => {
  const steps = run([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(steps.every((s) => s.ease >= MIN_EASE)).toBe(true);
  expect(steps.at(-1)?.ease).toBe(MIN_EASE);
  expect(steps.at(-1)?.intervalDays).toBe(1);
});

test("dueAt is the new interval away from the clock it was handed", () => {
  const [step] = run([5]);
  expect(step?.dueAt.getTime()).toBe(NOW.getTime() + DAY_MS);

  const [later] = run([5], { ease: 2.5, intervalDays: 6, repetitions: 2 });
  expect(later?.dueAt.getTime()).toBe(NOW.getTime() + 15 * DAY_MS);
});

test("grades outside 0–5 are clamped rather than thrown at the caller", () => {
  expect(schedule(NEW_CARD, 99, NOW).repetitions).toBe(1);
  expect(schedule(NEW_CARD, -4, NOW).repetitions).toBe(0);
  expect(schedule(NEW_CARD, 4.6, NOW).ease).toBe(2.6);
});

test("a corrupt row is scheduled from sane defaults instead of producing NaN", () => {
  const broken = { ease: Number.NaN, intervalDays: -3, repetitions: -1 } as Sm2State;
  const step = schedule(broken, 5, NOW);
  expect(step.ease).toBe(2.6);
  expect(step.intervalDays).toBe(1);
  expect(Number.isNaN(step.dueAt.getTime())).toBe(false);
});

test("the suggested grade tracks the rubric bands", () => {
  expect(gradeFromScores(9)).toBe(5);
  expect(gradeFromScores(7.5)).toBe(5);
  expect(gradeFromScores(7.49)).toBe(3);
  expect(gradeFromScores(5.5)).toBe(3);
  expect(gradeFromScores(5.49)).toBe(1);
  expect(gradeFromScores(0)).toBe(1);
});

test("prevDayKey steps back over month, year and leap-day boundaries", () => {
  expect(prevDayKey("2026-08-26")).toBe("2026-08-25");
  expect(prevDayKey("2026-08-01")).toBe("2026-07-31");
  expect(prevDayKey("2026-01-01")).toBe("2025-12-31");
  expect(prevDayKey("2026-03-01")).toBe("2026-02-28");
  expect(prevDayKey("2028-03-01")).toBe("2028-02-29");
});

const days = (...keys: string[]) => new Set(keys);

test("a run of consecutive days counts every one of them", () => {
  const set = days("2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23");
  expect(streakDays(set, "2026-08-26")).toBe(4);
});

test("the streak survives a day that has not been drilled yet", () => {
  const set = days("2026-08-25", "2026-08-24");
  expect(streakDays(set, "2026-08-26")).toBe(2);
});

test("a missed day ends the streak, and older runs do not count", () => {
  const set = days("2026-08-24", "2026-08-23", "2026-08-22");
  expect(streakDays(set, "2026-08-26")).toBe(0);
});

test("a gap inside the history stops the walk at the gap", () => {
  const set = days("2026-08-26", "2026-08-25", "2026-08-23", "2026-08-22");
  expect(streakDays(set, "2026-08-26")).toBe(2);
});

test("no reviews at all is a streak of zero", () => {
  expect(streakDays(days(), "2026-08-26")).toBe(0);
});

test("days after today are ignored — the walk only ever goes backwards", () => {
  const set = days("2026-08-27", "2026-08-28");
  expect(streakDays(set, "2026-08-26")).toBe(0);
});

test("a degenerate prevKey cannot spin forever", () => {
  const set = days("2026-08-26");
  expect(streakDays(set, "2026-08-26", (k) => k)).toBe(400);
});

test("the same reviews give different streaks in different zones", () => {
  const at = [new Date("2026-08-24T20:00:00Z"), new Date("2026-08-25T18:00:00Z")];
  const now = new Date("2026-08-25T19:00:00Z");

  const dayKey = (d: Date, zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const keys = (zone: string) => new Set(at.map((d) => dayKey(d, zone)));

  expect(keys("UTC")).toEqual(days("2026-08-24", "2026-08-25"));
  expect(keys("Asia/Kolkata")).toEqual(days("2026-08-25"));

  expect(streakDays(keys("UTC"), dayKey(now, "UTC"))).toBe(2);
  expect(streakDays(keys("Asia/Kolkata"), dayKey(now, "Asia/Kolkata"))).toBe(1);
});

test("the start of the day is the user's midnight, not UTC's", () => {
  const now = new Date("2026-08-26T00:30:00.000Z");
  expect(startOfDayIn(now, "Asia/Kolkata").toISOString()).toBe("2026-08-25T18:30:00.000Z");
  expect(startOfDayIn(now, "UTC").toISOString()).toBe("2026-08-26T00:00:00.000Z");
});

test("the start of the day is never in the future and never more than a day back", () => {
  const now = new Date("2026-08-26T09:14:37.412Z");
  for (const zone of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const start = startOfDayIn(now, zone);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime() - start.getTime()).toBeLessThan(DAY_MS);
  }
});

test("midnight in the user's zone is the start of the day, not the end of the last one", () => {
  const now = new Date("2026-08-25T18:30:00.000Z");
  expect(startOfDayIn(now, "Asia/Kolkata").toISOString()).toBe(now.toISOString());
});

test("an unusable timezone falls back to UTC instead of throwing", () => {
  const now = new Date("2026-08-26T09:14:37.412Z");
  expect(startOfDayIn(now, "Mars/Olympus").toISOString()).toBe("2026-08-26T00:00:00.000Z");
});
