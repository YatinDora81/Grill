"use client";

import { useState } from "react";
import { apiPost, apiDelete } from "@/lib/apiClient";
import { cx } from "@/components/ui";

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
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from starred questions" : "Save this question"}
      title={on ? "Starred — find it under Starred" : "Save this question"}
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
        on ? "text-ember hover:bg-ember-soft" : "text-ink-muted hover:bg-paper-sunken hover:text-ink",
      )}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.78l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
