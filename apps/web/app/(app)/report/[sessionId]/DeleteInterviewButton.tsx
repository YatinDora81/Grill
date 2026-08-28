"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeleteSessionResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, cx } from "@/components/ui";

export function DeleteInterviewButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await apiPost<DeleteSessionResponse>("/api/interview/delete", {
        session_id: sessionId,
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Could not delete this interview.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Delete interview
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-(--scrim-confirm) px-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-interview-title"
            className="w-full max-w-md border border-line-strong bg-paper-raised p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-interview-title"
              className="font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.02em] uppercase"
            >
              Delete this interview?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              It will disappear from your dashboard and reports. This cannot be undone from the app.
            </p>
            {error ? <p className="mt-3 text-sm text-weak">{error}</p> : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                className={cx(busy && "opacity-70")}
                onClick={() => void confirmDelete()}
              >
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
