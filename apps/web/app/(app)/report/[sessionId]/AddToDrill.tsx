"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";

export function AddToDrill({ turnId }: { turnId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "added" | "failed">("idle");

  async function add() {
    if (state === "busy" || state === "added") return;
    setState("busy");
    try {
      await apiPost("/api/drill/cards", { turn_id: turnId });
      setState("added");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      className="star disabled:opacity-60"
      data-on={state === "added"}
      onClick={add}
      disabled={state === "busy" || state === "added"}
      aria-label={
        state === "added"
          ? "Already in your drill deck"
          : "Add this question to your drill deck"
      }
      title={
        state === "added"
          ? "In your drill deck — it comes back on a schedule"
          : "Ask me this again on a schedule"
      }
    >
      {state === "added"
        ? "✓ in drill"
        : state === "busy"
          ? "adding…"
          : state === "failed"
            ? "try again"
            : "+ drill"}
    </button>
  );
}
