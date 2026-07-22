"use client";

import { useState } from "react";
import { apiPost, apiDelete } from "@/lib/apiClient";

/**
 * Star a question from the replay.
 *
 * Optimistic: the star is a bookmark, and waiting on a round-trip to fill in an
 * icon makes it feel broken. A failure rolls it back rather than lying.
 */
export function StarQuestion({
  turnId,
  questionHash,
  initial,
}: {
  turnId: string;
  /** Known up front so unstarring doesn't need the POST's response. */
  questionHash: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      if (next) await apiPost("/api/starred", { turn_id: turnId });
      else await apiDelete("/api/starred", { question_hash: questionHash });
    } catch {
      setOn(!next); // roll back — never show a star that isn't saved
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="star"
      data-on={on}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from starred questions" : "Save this question"}
      title={on ? "Starred — find it under Starred" : "Save this question"}
    >
      {on ? "★ starred" : "☆ star"}
    </button>
  );
}
