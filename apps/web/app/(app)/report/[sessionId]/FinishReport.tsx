"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EndResponse } from "@repo/types";
import { apiGet, apiPost, ApiClientError } from "@/lib/apiClient";
import type { ReportStatusResponse } from "@/app/api/report/[sessionId]/status/route";
import { Button, Card, cx, ErrorNote, Spinner } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { DeleteInterviewButton } from "./DeleteInterviewButton";

const POLL_MS = 2_500;

const WAIT_CEILING_MS = 4 * 60_000;

const ESTIMATE_MS = 30_000;
const ESTIMATE_PCT = 88;
const CEILING_PCT = 97;

function progressPct(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= WAIT_CEILING_MS) return CEILING_PCT;
  if (elapsedMs < ESTIMATE_MS) return (elapsedMs / ESTIMATE_MS) * ESTIMATE_PCT;
  const over = (elapsedMs - ESTIMATE_MS) / (WAIT_CEILING_MS - ESTIMATE_MS);
  return ESTIMATE_PCT + (CEILING_PCT - ESTIMATE_PCT) * over;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const STAGES = [
  {
    key: "transcribe",
    title: "Writing down what you said",
    detail: "Every answer was turned into text the moment you gave it, word by word.",
    done: true,
  },
  {
    key: "score",
    title: "Scoring each answer",
    detail: "Each answer was marked as you went. Those scores are already banked.",
    done: true,
  },
  {
    key: "pace",
    title: "Counting pace, pauses and fillers",
    detail: "How fast you spoke, where you stopped, how often “um” showed up.",
    done: false,
  },
  {
    key: "acoustics",
    title: "Listening to how you sounded",
    detail: "Pitch and volume read out of the raw recording — not guessed from your words.",
    done: false,
  },
  {
    key: "verdict",
    title: "Writing the verdict",
    detail: "One score, what worked, what didn't, and the quote that proves each point.",
    done: false,
  },
] as const;

const STAGE_ROW =
  "grid grid-cols-[26px_minmax(0,1fr)] items-start gap-x-4 gap-y-1 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[26px_minmax(0,1fr)_auto] sm:items-center sm:px-6 sm:py-[1.1rem]";
const STAGE_MARK =
  "grid size-[26px] place-items-center border font-mono text-[0.7rem] leading-none";
const STAGE_TITLE = "font-mono text-[0.76rem] uppercase tracking-[0.1em]";
const STAGE_NOTE =
  "col-start-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] whitespace-nowrap sm:col-start-3 sm:text-right";

const SKEL = "block bg-(--color-track)";

export function FinishReport({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [gaveUp, setGaveUp] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const failed = useRef(false);

  const kick = useCallback(async () => {
    try {
      await apiPost<EndResponse>("/api/interview/end", { session_id: sessionId });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "report_in_progress") return;
      failed.current = true;
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the report.");
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    failed.current = false;

    void kick();

    const poll = async () => {
      if (cancelled || failed.current) return;
      try {
        const s = await apiGet<ReportStatusResponse>(`/api/report/${sessionId}/status`);
        if (cancelled) return;

        if (s.ready) {
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
      } catch {}
      timer = setTimeout(poll, POLL_MS);
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, router, kick, attempt]);

  const stopped = Boolean(error) || gaveUp;

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [stopped]);

  const elapsed = Math.max(0, now - startedAt.current);
  const pct = progressPct(elapsed);
  const overrun = elapsed > ESTIMATE_MS;

  const title = error
    ? "The report didn't build"
    : gaveUp
      ? "Still working on it"
      : "Scoring your interview";
  const blurb = error
    ? "The build was retried until it gave up, so nothing is running for this interview now. Every answer you gave is still saved."
    : gaveUp
      ? "This is taking longer than it should. It's still queued and nothing is lost — check back in a few minutes."
      : "Reading every answer back and measuring how you sounded. It carries on without you, so you can leave and come back.";
  const eyebrow = error ? "Build stopped" : gaveUp ? "Still queued" : "Building your report";

  return (
    <main className="wrap report-main">
      <Link href="/dashboard" className="back">
        ← Dashboard
      </Link>

      <ExplainBanner />

      <header className="mt-5 grid gap-x-10 gap-y-6 border-b border-line pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="flex items-center gap-2.5 font-mono text-[0.62rem] tracking-[0.2em] uppercase text-ember">
            {!stopped ? <Spinner className="text-ember" /> : null}
            04 — {eyebrow}
          </p>
          <h1 className="mt-4 max-w-[13ch] font-display text-[clamp(2.1rem,5vw,3.6rem)] leading-[0.94] font-extrabold tracking-[-0.02em] uppercase">
            {title}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-soft">{blurb}</p>
        </div>

        {!stopped ? (
          <div className="shrink-0 sm:text-right">
            <div className="font-display text-[clamp(2.6rem,6vw,4.2rem)] leading-[0.9] font-extrabold tabular-nums text-ember">
              {Math.round(pct)}
              <span className="font-mono text-[0.28em] align-baseline text-ink-muted">%</span>
            </div>
            <p className="mt-2 font-mono text-[0.63rem] tracking-[0.16em] uppercase text-ink-muted">
              {clock(elapsed)} on this page
            </p>
            <p className="mt-1 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-soft">
              {overrun ? "longer than usual" : "usually about 30 seconds"}
            </p>
          </div>
        ) : null}
      </header>

      {!stopped ? (
        <>
          <div
            className="relative h-1.5 overflow-hidden border border-t-0 border-line bg-paper-sunken"
            role="progressbar"
            aria-label="Report build progress, estimated from elapsed time"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="absolute inset-y-0 left-0 overflow-hidden bg-ember transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct.toFixed(1)}%` }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 block animate-sheen bg-linear-to-r from-transparent via-(--sheen-hi) to-transparent"
              />
            </div>
          </div>
          <p className="mt-2.5 font-mono text-[0.6rem] leading-relaxed tracking-[0.14em] uppercase text-ink-muted">
            Estimated — paced by this page&rsquo;s clock, not reported by the server
          </p>
          <Explain>
            That bar is paced off the clock, not off the server — the build doesn&rsquo;t report
            where it is. It&rsquo;s <b>how long this usually takes</b>, so a slow one will run past
            it without anything being wrong.
          </Explain>
        </>
      ) : null}

      {!error ? (
        <>
          <p className="mt-9 font-mono text-[0.58rem] tracking-[0.2em] uppercase text-ink-muted">
            What the build does — the first two finished while you answered
          </p>
          <ol className="mt-3 border border-line">
            {STAGES.map((s) => (
              <li key={s.key} className={STAGE_ROW}>
                <span
                  aria-hidden="true"
                  className={cx(
                    STAGE_MARK,
                    s.done
                      ? "border-(--edge-stage-done) text-strong"
                      : "border-line text-(--color-ink-faint)",
                  )}
                >
                  {s.done ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  <span className={cx(STAGE_TITLE, s.done ? "text-ink" : "text-ink-muted")}>
                    {s.title}
                  </span>
                  <span className="mt-1.5 block text-[0.85rem] leading-relaxed text-ink-muted">
                    {s.detail}
                  </span>
                </span>
                <span className={cx(STAGE_NOTE, s.done ? "text-strong" : "text-ink-muted")}>
                  {s.done ? "Done" : "To come"}
                </span>
              </li>
            ))}
          </ol>

          <ReportSkeleton />
        </>
      ) : null}

      {!error ? (
        <div className="mt-9 grid gap-4 md:grid-cols-2">
          <Note title="Safe to close this">
            The build runs on the server, not in this tab, so closing it doesn&rsquo;t stop
            anything. The interview stays on your dashboard and links back to this page.{" "}
            <b className="text-ink">Nothing is lost if you leave.</b>
          </Note>
          <Note title="If it stalls">
            A build that dies still counts as queued, so{" "}
            <b className="text-ink">reopening this page</b> starts it again and a scheduled sweep
            picks up whatever nobody reopened. After enough failed attempts it stops and tells you
            why.
          </Note>
        </div>
      ) : null}

      {stopped ? (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => {
              setError("");
              setGaveUp(false);
              startedAt.current = Date.now();
              setNow(Date.now());
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <DeleteInterviewButton sessionId={sessionId} />
          {error ? (
            <p className="mono-note basis-full">
              Try again re-checks the server and restarts the build only if it has attempts left.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </main>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-2 font-mono text-[0.58rem] tracking-[0.18em] uppercase text-ember">
        {title}
      </div>
      <p className="text-sm leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

const METER_W = ["w-[62%]", "w-[45%]", "w-[74%]"] as const;

function ReportSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-9 overflow-hidden border border-line bg-paper-raised p-5 sm:p-6"
    >
      <div className="mb-6 font-mono text-[0.58rem] tracking-[0.2em] uppercase text-ink-muted">
        What you&rsquo;ll get
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3 border border-line p-4">
          <span className={cx(SKEL, "h-2 w-[42%]")} />
          <span className={cx(SKEL, "h-11 w-[54%]")} />
          <span className={cx(SKEL, "h-1.5 w-full")} />
          <span className={cx(SKEL, "h-2 w-[88%]")} />
          <span className={cx(SKEL, "h-2 w-[63%]")} />
        </div>
        <div className="grid content-start gap-4">
          {METER_W.map((w) => (
            <div key={w} className="grid gap-2">
              <div className="flex items-center justify-between gap-4">
                <span className={cx(SKEL, "h-2 w-[46%]")} />
                <span className={cx(SKEL, "h-2 w-[14%]")} />
              </div>
              <span className="block h-[3px] bg-paper-sunken">
                <span className={cx("block h-full bg-(--color-track)", w)} />
              </span>
              <span className={cx(SKEL, "h-2 w-[84%]")} />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {["01", "02", "03"].map((k) => (
          <div key={k} className={cx(SKEL, "h-24")} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {["pace", "pause", "filler", "pitchvar", "energy", "meanpitch"].map((k) => (
          <div key={k} className={cx(SKEL, "h-16")} />
        ))}
      </div>

      <span className="pointer-events-none absolute inset-0 block animate-sheen bg-linear-to-r from-transparent via-ink/8 to-transparent" />
    </div>
  );
}
