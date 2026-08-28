"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobImportResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Bookmarklet } from "../profile/Bookmarklet";

const URL_MAX = 2_000;
const PAGE_TEXT_MAX = 60_000;

export interface JobPageHandoff {
  url: string;
  page_title?: string;
  page_text: string;
}

export interface JobUrlImportProps {
  onImported: (job: JobImportResponse) => void;
  handoff?: JobPageHandoff | null;
  siteUrl?: string;
  disabled?: boolean;
}

interface ImportError {
  code: string;
  message: string;
}

const SOURCE_LABEL: Record<JobImportResponse["source"], string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  generic: "the posting page",
  bookmarklet: "your browser",
};

export function readImportHandoff(hash: string): JobPageHandoff | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = raw.match(/(?:^|&)import=([^&]*)/);
  if (!match?.[1]) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const { u, t, x } = payload as { u?: unknown; t?: unknown; x?: unknown };
  if (typeof u !== "string" || typeof x !== "string") return null;
  if (!/^https:\/\//i.test(u.trim())) return null;
  const text = x.trim();
  if (!text) return null;

  return {
    url: u.trim().slice(0, URL_MAX),
    page_title: typeof t === "string" && t.trim() ? t.trim().slice(0, 300) : undefined,
    page_text: text.slice(0, PAGE_TEXT_MAX),
  };
}

export function JobUrlImport({ onImported, handoff, siteUrl, disabled = false }: JobUrlImportProps) {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<JobImportResponse | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const handled = useRef(false);

  const run = useCallback(
    async (body: Record<string, string>, sourceUrl: string) => {
      setImporting(true);
      setError(null);
      try {
        const job = await apiPost<JobImportResponse>("/api/interview/jd/extract", body);
        setImported(job);
        setUrl(sourceUrl);
        onImported(job);
      } catch (err) {
        setImported(null);
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : {
                code: "unknown",
                message: "Couldn't read that posting. Paste the description instead.",
              },
        );
      } finally {
        setImporting(false);
      }
    },
    [onImported],
  );

  useEffect(() => {
    if (!handoff || handled.current) return;
    handled.current = true;
    void run(
      {
        url: handoff.url,
        ...(handoff.page_title ? { page_title: handoff.page_title } : {}),
        page_text: handoff.page_text,
      },
      handoff.url,
    );
  }, [handoff, run]);

  function importUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError({ code: "empty", message: "Paste the link to the posting first." });
      return;
    }
    void run({ url: trimmed }, trimmed);
  }

  const busy = importing || disabled;

  return (
    <div className="mt-3.5">
      <div className="repo-row">
        <input
          id="job_url"
          className="input"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={URL_MAX}
          placeholder="https://jobs.lever.co/acme/…"
          aria-label="Job posting URL"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!busy) importUrl();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm shrink-0"
          onClick={importUrl}
          disabled={busy || !url.trim()}
        >
          {importing ? "Reading the posting…" : "Import"}
        </button>
      </div>

      {imported && (
        <div className="repo-meta">
          <span className="repo-chip">
            <b>{imported.title || "Untitled posting"}</b>
            {imported.company ? ` · ${imported.company}` : ""}
            {imported.location ? ` · ${imported.location}` : ""}
          </span>
          <span className="form-note" style={{ marginTop: 0 }}>
            read from {SOURCE_LABEL[imported.source]} · edit anything below before you start
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3" role="alert">
          <p className="error-note" style={{ marginTop: 0 }}>
            {error.message}
          </p>
          {error.code === "login_wall" && <Bookmarklet siteUrl={siteUrl} compact />}
        </div>
      )}

      <p className="form-note">
        Greenhouse, Lever and Ashby links import instantly. Anything else we read once and clean up
        — the interview itself never visits the posting.
      </p>
    </div>
  );
}
