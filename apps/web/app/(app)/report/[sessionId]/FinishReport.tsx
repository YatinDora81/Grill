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

/** Gap between polls. Builds take ~30s, so this is ~12 cheap requests. */
const POLL_MS = 2_500;

/**
 * Give up waiting after this long and tell them to come back. The build itself
 * is not abandoned — it's queued server-side and keeps going without us.
 */
const WAIT_CEILING_MS = 4 * 60_000;

/**
 * What a build usually costs, and the only thing the bar below is drawn from.
 * Matches the ~30s the queue itself documents; a bigger figure would leave the
 * bar reading half-done at the moment the report actually lands.
 *
 * There is no pipeline stage on the server to read: no jobs table, no progress
 * column, no events stream. The one honest signal a client has is its own clock,
 * so everything the screen shows about progress is derived from this constant and
 * has to be labelled as the estimate it is.
 */
const ESTIMATE_MS = 30_000;
/** Where the bar sits when the estimate is spent. The last stretch is the tail. */
const ESTIMATE_PCT = 88;
/** 100% means the report is on screen. Nothing else is allowed to claim it. */
const CEILING_PCT = 97;

/**
 * Elapsed time → a percentage that is honest about being a guess.
 *
 * Linear to ESTIMATE_PCT over the estimate, then a slower run to CEILING_PCT
 * across the rest of the wait. Overrunning the estimate is normal — the server
 * lease is six minutes and this client watches for four — so the bar has to keep
 * moving past it. A bar parked on 99 reads as a crash, and a bar that hits 100
 * with no report under it teaches people the number is a lie.
 */
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

/**
 * What the build actually does, in order.
 *
 * `done` is a fact, not a guess: transcription and per-answer scoring both run
 * inside /api/interview/answer, and are finished before the session is ever
 * marked generating_report. The rest cannot be shown as "running" because
 * nothing on the server says which one is — they are listed as what's coming.
 */
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
/** Square, like every other mark in the product — a circle here would read as a radio. */
const STAGE_MARK =
  "grid size-[26px] place-items-center border font-mono text-[0.7rem] leading-none";
const STAGE_TITLE = "font-mono text-[0.76rem] uppercase tracking-[0.1em]";
const STAGE_NOTE =
  "col-start-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] whitespace-nowrap sm:col-start-3 sm:text-right";

/**
 * Skeleton block. Contrasts with the panel it sits on, so it reads as unfilled —
 * which on dark means lighter than it and on paper means darker. `--color-track`
 * rather than `--color-line`: these are slabs, and a value picked to survive as a
 * 1px hairline cannot hold a 44px block once the direction flips.
 */
const SKEL = "block bg-(--color-track)";

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
  const [now, setNow] = useState(() => Date.now());
  const failed = useRef(false);

  const kick = useCallback(async () => {
    try {
      // Idempotent, and safe to race the running build: /end enqueues, and the
      // lease means only one builder can ever hold the session.
      await apiPost<EndResponse>("/api/interview/end", { session_id: sessionId });
    } catch (err) {
      // `report_in_progress` is the happy path here, not a failure.
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

  /**
   * The clock the bar is drawn from, kept in an effect of its own on purpose.
   * The poll effect's deps are [sessionId, router, kick, attempt]; letting a
   * per-second value anywhere near them would tear the loop down and rebuild it
   * every tick, which is exactly the dead-loop bug the tests exist to catch.
   */
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
  /**
   * `error` is the server's terminal state, not a hiccup: reportQueue only
   * writes it once the attempts are spent. So nothing is running behind this
   * screen, and none of the "leave it with us" copy below may appear with it.
   */
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

      {/* Same URL as the finished report, so the banner has to be here too —
          otherwise a reader with the mode on watches it appear out of nowhere
          when the build lands, which reads as the page gaining a feature on
          reload. Outside the `error` / `gaveUp` guards deliberately: those two
          branches render no <Explain> at all, and a mode that announces itself
          only on the happy path is the "dead toggle" the banner exists to
          prevent. */}
      <ExplainBanner />

      {/* `items-end` so the figure sits on the headline's baseline block and both
          land on the rule the track then hangs off. */}
      <header className="mt-5 grid gap-x-10 gap-y-6 border-b border-line pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0" role="status" aria-live="polite">
          {/* Not `.kicker`: that class draws a trailing rule, and this eyebrow sits
              directly above a headline that already has one under it. */}
          <p className="flex items-center gap-2.5 font-mono text-[0.62rem] tracking-[0.2em] uppercase text-ember">
            {!stopped ? <Spinner className="text-ember" /> : null}
            04 — {eyebrow}
          </p>
          {/* Held to a short measure on purpose: the headline is meant to break
              across two or three lines and read as a stack, not a banner. */}
          <h1 className="mt-4 max-w-[13ch] font-display text-[clamp(2.1rem,5vw,3.6rem)] leading-[0.94] font-extrabold tracking-[-0.02em] uppercase">
            {title}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-soft">{blurb}</p>
        </div>

        {/*
          The percentage leads and elapsed time backs it up, which is the reverse
          of what this screen used to do. The old order was defensible — elapsed
          is measured, the percentage is a guess — but it left the one figure
          people actually read set in a whisper. The guess is allowed to be the
          hero as long as it never stops saying it is one: hence the clock right
          under it, and the note under the track.
        */}
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
          {/*
            `border-t-0` welds the track to the header's rule, so the fill reads as
            that line filling in rather than as a widget parked below it.

            aria-valuenow is supplied now that the percentage is stated on screen.
            It used to be omitted so assistive tech wouldn't be handed a clock
            reading dressed up as build progress — but with the figure set in
            display type above, withholding it only means AT users get less. The
            caveat rides along in the accessible name instead.
          */}
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
              {/* A light sweep, not a dark one: the travelling sheen has to read
                  as something moving over the red. Which of the two palette ends
                  is the lighter one is exactly what reverses between the modes —
                  on the near-black page it is the ink, on the press sheet it is
                  the paper — so this cannot stay `via-ink/30`, which would drag
                  a shadow across the bar and turn the glint into a smudge.
                  `--sheen-hi` mixes toward whichever end is lighter where it
                  lands, and is byte-identical to `ink/30` on dark. */}
              <span
                aria-hidden="true"
                className="absolute inset-0 block animate-sheen bg-linear-to-r from-transparent via-(--sheen-hi) to-transparent"
              />
            </div>
          </div>
          {/* Not behind explain mode: a reader who never turns that on still has
              to be told the bar is a pacing animation, not a measurement. */}
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
                {/* Both edges and the faint numeral are tokens rather than alpha
                    modifiers, because an alpha cannot express what light needs:
                    the faint ink step collapses to solid there, which is the
                    only reason it finally clears AA, and a translucent border
                    reads weaker on a bright ground than on a dark one. */}
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
                {/* Green only on the stages that really are finished. The reference
                    also has a red "running" row; there is no server signal that
                    says which stage is live, so inventing one is off the table. */}
                <span className={cx(STAGE_NOTE, s.done ? "text-strong" : "text-ink-muted")}>
                  {s.done ? "Done" : "To come"}
                </span>
              </li>
            ))}
          </ol>

          <ReportSkeleton />
        </>
      ) : null}

      {/* Only while something is actually running. In the error state every
          sentence in here would be a lie told directly under "didn't build". */}
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
          {/* A build whose attempts are spent is refused by /end, so promising a
              restart outright would be a promise this button can't keep. */}
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

/** Meter track widths — layout rhythm only, so they carry no meaning. */
const METER_W = ["w-[62%]", "w-[45%]", "w-[74%]"] as const;

/**
 * The shape of the report that's coming, mirroring report/[sessionId]/page.tsx:
 * the verdict block and its band, the three category meters beside it, the three
 * fixes, and the delivery tiles.
 *
 * Needs no data at all, which is the point — it makes the wait read as assembly
 * instead of a stall, without a single invented number. It stops after the four
 * blocks that fit on one screen: an outline that runs longer than the fold is
 * just noise, since nobody scrolls a placeholder. Hidden from assistive tech for
 * the same reason — an outline of nothing has nothing to announce.
 */
function ReportSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-9 overflow-hidden border border-line bg-paper-raised p-5 sm:p-6"
    >
      <div className="mb-6 font-mono text-[0.58rem] tracking-[0.2em] uppercase text-ink-muted">
        What you&rsquo;ll get
      </div>

      {/* verdict panel + the three category meters */}
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3 border border-line p-4">
          <span className={cx(SKEL, "h-2 w-[42%]")} />
          <span className={cx(SKEL, "h-11 w-[54%]")} />
          {/* the score band, not a ring — the redesigned verdict is a bar */}
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

      {/* the three fixes */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {["01", "02", "03"].map((k) => (
          <div key={k} className={cx(SKEL, "h-24")} />
        ))}
      </div>

      {/* how you sounded — one tile per delivery measure */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {["pace", "pause", "filler", "pitchvar", "energy", "meanpitch"].map((k) => (
          <div key={k} className={cx(SKEL, "h-16")} />
        ))}
      </div>

      <span className="pointer-events-none absolute inset-0 block animate-sheen bg-linear-to-r from-transparent via-ink/8 to-transparent" />
    </div>
  );
}
