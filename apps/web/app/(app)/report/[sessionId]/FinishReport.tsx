"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EndResponse } from "@repo/types";
import { apiGet, apiPost, ApiClientError } from "@/lib/apiClient";
import type { ReportStatusResponse } from "@/app/api/report/[sessionId]/status/route";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

/** Gap between polls. Builds take ~30s, so this is ~12 cheap requests. */
const POLL_MS = 2_500;

/**
 * Give up waiting after this long and tell them to come back. The build itself
 * is not abandoned — it's queued server-side and keeps going without us.
 */
const WAIT_CEILING_MS = 4 * 60_000;

/**
 * Shown when a session has no report yet.
 *
 * Since reports went async this is usually not an error at all — it's the
 * normal state for the ~30s after an interview ends, so the screen waits rather
 * than demanding a button press.
 *
 * On mount it re-kicks the build. That's the recovery path that matters on
 * Vercel Hobby, where cron only runs once a day: if the original `after()` build
 * was killed, opening this page is what gets it going again, and the lease makes
 * the kick harmless when a build is already running.
 */
export function FinishReport({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [gaveUp, setGaveUp] = useState(false);
  /**
   * Bumped by "Try again". The poll loop stops by returning instead of
   * rescheduling, so clearing the error state alone leaves it dead — only a new
   * value in the effect's deps builds a fresh loop.
   */
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(Date.now());

  const kick = useCallback(async () => {
    try {
      // Idempotent, and safe to race the running build: /end enqueues, and the
      // lease means only one builder can ever hold the session.
      await apiPost<EndResponse>("/api/interview/end", { session_id: sessionId });
    } catch (err) {
      // `report_in_progress` is the happy path here, not a failure.
      if (err instanceof ApiClientError && err.code === "report_in_progress") return;
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the report.");
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    void kick();

    const poll = async () => {
      if (cancelled) return;
      try {
        const s = await apiGet<ReportStatusResponse>(`/api/report/${sessionId}/status`);
        if (cancelled) return;

        if (s.ready) {
          // The server component above us renders the real report; refreshing is
          // what swaps this screen out for it.
          router.refresh();
          return;
        }
        if (s.status === "error") {
          setError(s.error_reason || "The report failed to build.");
          return;
        }
        if (Date.now() - startedAt.current > WAIT_CEILING_MS) {
          setGaveUp(true);
          return;
        }
      } catch {
        // A dropped poll says nothing about the build — keep waiting.
      }
      timer = setTimeout(poll, POLL_MS);
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, router, kick, attempt]);

  const stopped = Boolean(error) || gaveUp;

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <Card className="p-8 text-center">
        {!stopped ? (
          <>
            <Spinner className="text-ember" />
            <h1 className="mt-5 font-display text-3xl tracking-tight">Scoring your interview</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Reading every answer back and measuring how you sounded. This usually takes under a
              minute — it carries on without you, so you can leave and come back.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl tracking-tight">
              {gaveUp ? "Still working on it" : "The report didn't build"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {gaveUp
                ? "This is taking longer than it should. It's still queued and nothing is lost — check back in a few minutes."
                : "Nothing is lost; every answer is saved. Try building it again."}
            </p>
          </>
        )}

        {stopped ? (
          <div className="mt-6 flex justify-center">
            <Button
              size="lg"
              onClick={() => {
                setError("");
                setGaveUp(false);
                startedAt.current = Date.now();
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 text-left">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
