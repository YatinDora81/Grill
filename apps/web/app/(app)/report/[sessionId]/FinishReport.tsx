"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EndResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

/**
 * Shown when a session has no report yet. /end is idempotent and recovers a
 * build that died mid-flight, so the honest move is to offer the retry rather
 * than pretend the session is lost.
 */
export function FinishReport({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      await apiPost<EndResponse>("/api/interview/end", { session_id: sessionId });
      router.refresh();
    } catch (err) {
      const inProgress = err instanceof ApiClientError && err.code === "report_in_progress";
      setError(
        inProgress
          ? "A report is already being built for this session. Give it a minute, then try again."
          : err instanceof ApiClientError
            ? err.message
            : "Couldn't build the report.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <Card className="p-8 text-center">
        <h1 className="font-display text-3xl tracking-tight">No report yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          This interview hasn&apos;t been scored — the report either never ran or was
          interrupted. Nothing is lost; your answers are saved.
        </p>
        <div className="mt-6 flex justify-center">
          <Button onClick={run} disabled={busy} size="lg">
            {busy ? <Spinner /> : null}
            {busy ? "Building — up to a minute…" : "Build the report"}
          </Button>
        </div>
        {error ? (
          <div className="mt-4 text-left">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
