"use client";

import { useRef, useState } from "react";
import type { ResumeGapResponse } from "@repo/types";
import { apiPostForm, ApiClientError } from "@/lib/apiClient";
import { Button, ButtonLink, ErrorNote, Spinner, cx } from "@/components/ui";
import { Explain } from "@/components/Explain";

const JD_MAX_CHARS = 8_000;
const RESUME_MAX_CHARS = 15_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PENDING_JD_KEY = "grill.pendingJd";
const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,text/plain";

type MatchTone = "weak" | "mixed" | "strong";

const TONE_TEXT: Record<MatchTone, string> = {
  weak: "text-weak",
  mixed: "text-mixed",
  strong: "text-strong",
};

const TONE_BG: Record<MatchTone, string> = {
  weak: "bg-weak",
  mixed: "bg-mixed",
  strong: "bg-strong",
};

const TONE_VERDICT: Record<MatchTone, string> = {
  weak: "a stretch — close a gap before you apply",
  mixed: "worth applying, with prep",
  strong: "apply, then be ready to defend it",
};

const ZONES = [
  { label: "thin", width: "40%" },
  { label: "worth a shot", width: "30%" },
  { label: "strong", width: "30%" },
];

function matchTone(pct: number): MatchTone {
  if (pct < 40) return "weak";
  if (pct < 70) return "mixed";
  return "strong";
}

const DROP_BASE =
  "flex min-h-[168px] cursor-pointer flex-col items-start justify-center gap-2 border-2 border-dashed p-5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ember";
const DROP_REST = "border-line-strong bg-paper-sunken hover:border-ink-muted";
const DROP_HOT = "border-ember bg-ember-soft";

export function GapForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const [jd, setJd] = useState("");
  const [pasteResume, setPasteResume] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResumeGapResponse | null>(null);

  const hasResume = pasteResume ? resumeText.trim().length > 0 : file !== null;
  const ready = hasResume && jd.trim().length > 0;

  function takeFile(picked: File | undefined) {
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      setError("That file is too large — 5 MB is the ceiling.");
      return;
    }
    setError("");
    setResult(null);
    setFile(picked);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    takeFile(e.target.files?.[0]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    takeFile(e.dataTransfer.files?.[0]);
  }

  function swapInput() {
    setPasteResume((p) => !p);
    setFile(null);
    setResumeText("");
    setError("");
    setResult(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!jd.trim()) return setError("Paste the job description you want to be measured against.");
    if (!hasResume) return setError("Upload a résumé, or paste its text.");

    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("jd", jd.trim());
      if (pasteResume) form.append("resume_text", resumeText.trim());
      else if (file) form.append("resume", file);
      const res = await apiPostForm<ResumeGapResponse>("/api/tools/resume-gap", form);
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Couldn't reach the checker. Check your connection and try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function carryJdOver() {
    try {
      sessionStorage.setItem(PENDING_JD_KEY, jd.trim());
    } catch (err) {
      console.warn("[gap] could not stash the job description for /new:", err);
    }
  }

  const pct = result ? result.match_percent : 0;
  const tone = matchTone(pct);

  const status = busy
    ? "reading the posting · matching it line by line against your résumé"
    : result
      ? `done — ${pct}% match · nothing was saved`
      : ready
        ? "one comparison · nothing is saved unless you sign up"
        : "add your résumé and the posting, and it will compare them";

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="field-row">
              <span className="label" id="gap-resume-label">
                Résumé
              </span>
              <span className="hint">never stored</span>
            </div>

            {pasteResume ? (
              <>
                <textarea
                  aria-labelledby="gap-resume-label"
                  className="input area area-mono"
                  style={{ marginTop: 0, minHeight: 168 }}
                  rows={8}
                  maxLength={RESUME_MAX_CHARS}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Paste your résumé — plain text is fine, formatting doesn't matter."
                />
                <p className="count">
                  {resumeText.length.toLocaleString()} / {RESUME_MAX_CHARS.toLocaleString()}
                </p>
              </>
            ) : (
              <label
                className={cx(DROP_BASE, dragging ? DROP_HOT : DROP_REST)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  onChange={onPick}
                  aria-labelledby="gap-resume-label"
                  className="sr-only"
                />
                {file ? (
                  <span className="text-[0.95rem] break-all text-ink">
                    {file.name}{" "}
                    <span className={result ? "text-strong" : "text-ink-muted"}>
                      {result ? "✓ parsed" : "✓ ready"}
                    </span>
                  </span>
                ) : (
                  <span className="text-[0.95rem] text-ink">
                    Drop your résumé here, or{" "}
                    <i className="text-ember underline underline-offset-4 not-italic">browse</i>
                  </span>
                )}
                <span className="font-mono text-[0.68rem] tracking-[0.04em] text-ink-muted">
                  pdf · docx · txt — up to 5 MB
                </span>
              </label>
            )}

            <button type="button" onClick={swapInput} className="underlink mt-3.5 inline-block">
              {pasteResume ? "upload a file instead" : "or paste the text instead"}
            </button>
          </div>

          <div>
            <div className="field-row">
              <label className="label" htmlFor="gap-jd">
                Job description
              </label>
              <span className="hint">the posting you&rsquo;re going for</span>
            </div>
            <textarea
              id="gap-jd"
              className="input area"
              style={{ minHeight: 168 }}
              rows={8}
              maxLength={JD_MAX_CHARS}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Senior Backend Engineer — 3+ yrs React and TypeScript, owns services end-to-end, Postgres at scale, observability and on-call…"
            />
            <p className="count">
              {jd.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? <Spinner /> : null}
            {busy ? "Comparing…" : "Find the gaps"}
          </Button>
          <p className="mono-note" role="status">
            {status}
          </p>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}
      </form>

      {result ? (
        <section
          className="mt-[clamp(44px,7vh,64px)]"
          aria-label="Where the résumé meets the posting"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-line pb-2.5">
            <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
              The read
            </h2>
            <p className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-ink-muted">
              evidence only · unverifiable counts as a gap
            </p>
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span
                className={cx(
                  "font-display text-[2.6rem] leading-none font-extrabold tabular",
                  TONE_TEXT[tone],
                )}
              >
                {pct}%
              </span>
              <span className="font-mono text-[0.72rem] tracking-[0.1em] text-ink-soft">
                match — {TONE_VERDICT[tone]}
              </span>
            </div>

            <div
              className="relative mt-4 h-2 bg-line"
              role="img"
              aria-label={`${pct}% match — ${TONE_VERDICT[tone]}. The scale is marked at 40 and 70.`}
            >
              <div
                className={cx("absolute inset-y-0 left-0", TONE_BG[tone])}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
              <span
                className="absolute -top-[3px] h-[14px] w-px bg-line-strong"
                style={{ left: "40%" }}
              />
              <span
                className="absolute -top-[3px] h-[14px] w-px bg-line-strong"
                style={{ left: "70%" }}
              />
            </div>
            <div className="mt-2 flex font-mono text-[0.58rem] tracking-[0.14em] uppercase text-ink-muted">
              {ZONES.map((z) => (
                <span key={z.label} style={{ width: z.width }}>
                  {z.label}
                </span>
              ))}
            </div>

            <p className="mt-5 max-w-[62ch] text-[0.95rem] leading-relaxed text-ink-soft">
              {result.summary}
            </p>
            <Explain>
              The percentage is one model&rsquo;s honest read of how far this résumé gets against
              the requirements that matter — not a score anyone else will see. What it is actually
              good for is the two lists underneath: <b>a gap is anything the résumé cannot prove</b>
              , and that is exactly what an interviewer will push on.
            </Explain>
          </div>

          <div className="mt-10 grid gap-x-10 gap-y-9 md:grid-cols-2">
            <div>
              <h3 className="font-mono text-[0.69rem] tracking-[0.14em] uppercase text-strong">
                Covered — {result.covered.length}
              </h3>
              {result.covered.length ? (
                <ul className="mt-4 grid gap-5">
                  {result.covered.map((c, i) => (
                    <li key={i}>
                      <p className="text-[0.95rem] leading-relaxed text-ink">
                        <span className="text-strong" aria-hidden="true">
                          ✓
                        </span>{" "}
                        {c.requirement}
                      </p>
                      <p className="mt-1.5 font-mono text-[0.7rem] leading-relaxed text-ink-muted">
                        evidence: {c.evidence}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-[0.9rem] leading-relaxed text-ink-soft">
                  Nothing in the résumé lines up with this posting yet. That is a real answer, not a
                  failure to read it.
                </p>
              )}
            </div>

            <div>
              <h3 className="font-mono text-[0.69rem] tracking-[0.14em] uppercase text-weak">
                Gaps — {result.gaps.length}
              </h3>
              {result.gaps.length ? (
                <ul className="mt-4 grid gap-5">
                  {result.gaps.map((g, i) => (
                    <li key={i}>
                      <p className="text-[0.95rem] leading-relaxed text-ink">
                        <span className="text-weak" aria-hidden="true">
                          ✕
                        </span>{" "}
                        {g.requirement}
                      </p>
                      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-soft">
                        {g.why_it_matters}
                      </p>
                      <p className="mt-1.5 font-mono text-[0.7rem] leading-relaxed text-ink-muted">
                        close it: {g.how_to_close}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-[0.9rem] leading-relaxed text-ink-soft">
                  Nothing left unproven against this posting. Practise defending it out loud — that
                  is the part a résumé cannot do for you.
                </p>
              )}
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-7">
            <ButtonLink href="/signup?next=%2Fnew" onClick={carryJdOver}>
              Interview me on these gaps →
            </ButtonLink>
            <span className="font-mono text-[0.7rem] tracking-[0.06em] text-ink-soft">
              free · 8 questions · no card — JD carries over
            </span>
          </div>
        </section>
      ) : null}
    </>
  );
}
