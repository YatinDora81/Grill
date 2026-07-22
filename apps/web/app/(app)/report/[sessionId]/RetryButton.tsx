"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { StartResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { GrillToaster } from "@/components/toast";

/**
 * Re-run this interview on the same questions. Fast — nothing is generated, the
 * questions are copied — so this doesn't need the long "writing your first
 * question" wait a new interview does.
 */
export function RetryButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = await apiPost<StartResponse>("/api/interview/retry", {
        session_id: sessionId,
      });
      router.push(`/session/${res.session_id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Couldn't start the retry.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <GrillToaster />
      {/* The report's single ember button: re-running the same questions is the
          only way to measure progress on identical material. */}
      <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? "Setting it up…" : "Run it again"}
      </button>
    </>
  );
}
