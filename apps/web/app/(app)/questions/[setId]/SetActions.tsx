"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StartResponse } from "@repo/types";
import { apiDelete, apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, ErrorNote, Spinner } from "@/components/ui";

/**
 * The set page's two verbs: run these questions as a live interview, or
 * delete the set. A client island on an otherwise server-rendered document.
 */
export function SetActions({ setId, questionCount }: { setId: string; questionCount: number }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /**
   * Two-step delete, held in state rather than a confirm() dialog — the app
   * never uses native dialogs, and arming decays if they click anywhere else.
   */
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  /**
   * Same double-fire guard as every start button in the app: `starting` only
   * disables the control, and the POST holds open long enough for a second
   * click to land. Each call creates a real session, so the one the router
   * doesn't navigate to would be stranded `in_progress` forever.
   */
  const startingRef = useRef(false);

  async function runInterview() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError("");
    try {
      const res = await apiPost<StartResponse>(`/api/questions/${setId}/interview`, {});
      router.push(`/session/${res.session_id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the interview.");
      // Only reopened on failure; the success path navigates away.
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function deleteSet() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await apiDelete(`/api/questions/${setId}`, {});
      // Interviews already run from this set survive, by design — only the
      // document goes.
      router.push("/questions");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't delete the set.");
      setArmed(false);
      setDeleting(false);
    }
  }

  return (
    <div className="rv mb-2" data-io>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={runInterview} disabled={starting || deleting}>
          {starting ? (
            <>
              <Spinner /> Starting…
            </>
          ) : (
            "Run as interview"
          )}
        </Button>
        <span className="font-mono text-[11px] text-ink-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}, asked exactly as written — a
          full session with its own report.
        </span>
        <Button
          variant="danger"
          size="sm"
          className="ml-auto"
          onClick={deleteSet}
          disabled={starting || deleting}
          onBlur={() => setArmed(false)}
        >
          {deleting ? "Deleting…" : armed ? "Click again to delete" : "Delete set"}
        </Button>
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </div>
  );
}
