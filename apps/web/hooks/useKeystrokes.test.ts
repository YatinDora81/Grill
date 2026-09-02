import { describe, expect, test } from "bun:test";
import { createTracker } from "./useKeystrokes";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe("createTracker", () => {
  test("a problem nobody typed into reports no first edit", () => {
    const c = clock();
    const k = createTracker(0, c.now);
    c.at(30_000);
    const stats = k.finish();
    expect(stats.first_edit_ms).toBeNull();
    expect(stats.edits).toBe(0);
    expect(stats.submitted_at_ms).toBe(30_000);
    expect(stats.longest_idle_ms).toBe(30_000);
  });

  test("first edit is measured from the moment the problem was shown", () => {
    const c = clock(1_000);
    const k = createTracker(1_000, c.now);
    c.at(9_500);
    k.onEdit(0, 4);
    expect(k.finish().first_edit_ms).toBe(8_500);
  });

  test("characters added and deleted are counted separately", () => {
    const c = clock();
    const k = createTracker(0, c.now);
    k.onEdit(0, 10);
    k.onEdit(10, 4);
    k.onEdit(4, 9);
    const stats = k.finish();
    expect(stats.edits).toBe(3);
    expect(stats.chars_added).toBe(15);
    expect(stats.chars_deleted).toBe(6);
  });

  test("the longest idle stretch includes the tail after the last edit", () => {
    const c = clock();
    const k = createTracker(0, c.now);
    c.at(2_000);
    k.onEdit(0, 1);
    c.at(9_000);
    k.onEdit(1, 2);
    c.at(30_000);
    const stats = k.finish();
    expect(stats.longest_idle_ms).toBe(21_000);
    expect(stats.submitted_at_ms).toBe(30_000);
  });

  test("runs are timestamped and the timeline is capped at 200", () => {
    const c = clock();
    const k = createTracker(0, c.now);
    c.at(5_000);
    k.onRun(2, 3);
    for (let i = 0; i < 250; i++) k.onRun(1, 3);
    const stats = k.finish();
    expect(stats.runs).toBe(251);
    expect(stats.run_timeline).toHaveLength(200);
    expect(stats.run_timeline[0]).toEqual({ t_ms: 5_000, passed: 2, total: 3 });
  });
});
