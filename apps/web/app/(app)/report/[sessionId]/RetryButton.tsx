"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { StartResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { GrillToaster } from "@/components/toast";

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
      <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? "Setting it up…" : "Run it again"}
      </button>
    </>
  );
}
