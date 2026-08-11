"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { apiDelete, apiPost, ApiClientError } from "@/lib/apiClient";
import { Explain } from "@/components/Explain";
import { ErrorNote } from "@/components/ui";

interface ShareLink {
  url: string;
}

export function ShareControl({
  sessionId,
  sessionName,
  initiallyShared = false,
}: {
  sessionId: string;
  sessionName: string;
  initiallyShared?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [live, setLive] = useState(initiallyShared);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const afterPaint = useRef<"select" | "focus" | null>(null);

  useEffect(() => {
    const next = afterPaint.current;
    if (!next) return;
    afterPaint.current = null;
    if (next === "select") fieldRef.current?.select();
    else createRef.current?.focus();
  });

  async function create() {
    if (busy) return;
    setBusy("create");
    setError(null);
    try {
      const res = await apiPost<ShareLink>(`/api/report/${sessionId}/share`, {});
      setUrl(res.url);
      setLive(true);
      afterPaint.current = "select";
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create a link. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (busy) return;
    setBusy("revoke");
    setError(null);
    try {
      await apiDelete(`/api/report/${sessionId}/share`, {});
      setUrl(null);
      setLive(false);
      toast.success("Link revoked");
      afterPaint.current = "focus";
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? `${err.message} The link is still live.`
          : "Could not revoke the link — it is still live. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      fieldRef.current?.select();
      setError("Couldn't reach the clipboard. The link is selected — copy it by hand.");
    }
  }

  return (
    <div className="mt-12">
      <p className="kicker">Share the verdict</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3">
        {url ? (
          <>
            <input
              ref={fieldRef}
              readOnly
              value={url}
              aria-label="Public link to this verdict"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-[220px] flex-1 border border-line-strong bg-paper-sunken px-3 py-2.5 font-mono text-base text-ink-soft focus:border-ember focus:bg-paper focus:outline-none focus:ring-2 focus:ring-(--focus-glow) sm:text-[0.72rem]"
            />
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copy()}>
              Copy link
            </button>
            <button
              type="button"
              className="btn btn-danger btn-xs"
              disabled={busy !== null}
              onClick={() => void revoke()}
            >
              {busy === "revoke" ? "Revoking…" : "Revoke"}
            </button>
          </>
        ) : (
          <>
            <button
              ref={createRef}
              type="button"
              className="btn btn-ghost"
              disabled={busy !== null}
              onClick={() => void create()}
            >
              {busy === "create" ? "Minting a link…" : live ? "Make a new link" : "Share verdict"}
            </button>
            {live ? (
              <button
                type="button"
                className="btn btn-danger btn-xs"
                disabled={busy !== null}
                onClick={() => void revoke()}
              >
                {busy === "revoke" ? "Revoking…" : "Revoke"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="chip">scores only</span>
        <span className="chip">no transcripts</span>
        <span className="chip">no audio / video</span>
        <span className="chip">noindex</span>
      </div>

      <p className="mono-note" style={{ marginTop: 12 }}>
        Public shows scores only — never your words or recordings. The name{" "}
        <span className="text-ink">“{sessionName}”</span> is on it, so anyone with the link reads
        that too.
      </p>

      {url ? (
        <p className="mono-note" style={{ marginTop: 6 }}>
          This is a fresh link — any earlier one you made for this interview has stopped working.
        </p>
      ) : null}

      {live && !url ? (
        <p className="mono-note" style={{ marginTop: 6 }}>
          A link for this interview is live right now. The address itself isn&apos;t stored, so it
          can&apos;t be shown again — make a new one to copy, or revoke this one.
        </p>
      ) : null}

      <Explain>
        The link carries a random token, and we only keep its fingerprint — so nobody at Grill can
        reconstruct the address, and a stolen database hands over fingerprints rather than working
        links. <b>Revoke</b> kills it for good; making a new one kills the old one with it.
      </Explain>
    </div>
  );
}
