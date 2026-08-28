import type { DrillGrade } from "@repo/types";

export interface Sm2State {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

export interface Sm2Schedule extends Sm2State {
  dueAt: Date;
}

export const MIN_EASE = 1.3;

export const DEFAULT_EASE = 2.5;

export const PASS_GRADE = 3;

const DAY_MS = 86_400_000;

const STREAK_WALK_MAX = 400;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function schedule(state: Sm2State, grade: number, now = new Date()): Sm2Schedule {
  const g = Math.max(0, Math.min(5, Math.round(grade)));

  let ease = Number.isFinite(state.ease) ? state.ease : DEFAULT_EASE;
  let intervalDays = Number.isFinite(state.intervalDays) ? Math.max(0, state.intervalDays) : 0;
  let repetitions = Number.isFinite(state.repetitions) ? Math.max(0, state.repetitions) : 0;

  if (g < PASS_GRADE) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    intervalDays =
      repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.max(1, Math.round(intervalDays * ease));
    repetitions += 1;
  }

  ease = Math.max(MIN_EASE, ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));

  return {
    ease: round2(ease),
    intervalDays,
    repetitions,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

export function gradeFromScores(mean: number): DrillGrade {
  return mean >= 7.5 ? 5 : mean >= 5.5 ? 3 : 1;
}

export function prevDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function streakDays(
  days: Set<string>,
  todayKey: string,
  prevKey: (key: string) => string = prevDayKey,
): number {
  const yesterdayKey = prevKey(todayKey);
  let cursor = days.has(todayKey) ? todayKey : days.has(yesterdayKey) ? yesterdayKey : null;

  let n = 0;
  while (cursor !== null && days.has(cursor) && n < STREAK_WALK_MAX) {
    n += 1;
    cursor = prevKey(cursor);
  }
  return n;
}

export function startOfDayIn(now: Date, timeZone: string): Date {
  let parts: string;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch {
    console.warn(`[drill] unknown timezone ${JSON.stringify(timeZone)} — using UTC for "today"`);
    return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  }

  const [h = 0, m = 0, s = 0] = parts.split(":").map(Number);
  const elapsed = (h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}
