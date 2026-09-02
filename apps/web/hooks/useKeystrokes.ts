"use client";

import { useCallback, useRef } from "react";
import type { KeystrokeStats } from "@repo/types";

const TIMELINE_MAX = 200;

export interface KeystrokeTracker {
  onEdit: (prevLength: number, nextLength: number) => void;
  onRun: (passed: number, total: number) => void;
  finish: () => KeystrokeStats;
}

export function createTracker(
  shownAt: number,
  now: () => number = () => performance.now(),
): KeystrokeTracker {
  let first: number | null = null;
  let edits = 0;
  let added = 0;
  let deleted = 0;
  let lastEdit = shownAt;
  let longestIdle = 0;
  let runs = 0;
  const timeline: KeystrokeStats["run_timeline"] = [];

  return {
    onEdit(prev, next) {
      const t = now();
      if (first === null) first = t - shownAt;
      edits++;
      if (next > prev) added += next - prev;
      else deleted += prev - next;
      longestIdle = Math.max(longestIdle, t - lastEdit);
      lastEdit = t;
    },
    onRun(passed, total) {
      runs++;
      if (timeline.length < TIMELINE_MAX) {
        timeline.push({ t_ms: Math.round(now() - shownAt), passed, total });
      }
    },
    finish() {
      const t = now();
      longestIdle = Math.max(longestIdle, t - lastEdit);
      return {
        first_edit_ms: first === null ? null : Math.round(first),
        edits,
        chars_added: added,
        chars_deleted: deleted,
        longest_idle_ms: Math.round(longestIdle),
        runs,
        run_timeline: timeline,
        submitted_at_ms: Math.round(t - shownAt),
      };
    },
  };
}

export function useKeystrokes(shownAt: number): KeystrokeTracker {
  const ref = useRef<KeystrokeTracker | null>(null);
  ref.current ??= createTracker(shownAt);
  const onEdit = useCallback<KeystrokeTracker["onEdit"]>((p, n) => ref.current!.onEdit(p, n), []);
  const onRun = useCallback<KeystrokeTracker["onRun"]>((p, t) => ref.current!.onRun(p, t), []);
  const finish = useCallback(() => ref.current!.finish(), []);
  return { onEdit, onRun, finish };
}
