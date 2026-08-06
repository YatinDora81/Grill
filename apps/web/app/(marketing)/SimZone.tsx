"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";

/* ── the live session simulation ──────────────────────────────────────────
   The page's centrepiece, and the only claim on it a visitor can check: the
   label says "not a video — real DOM, running live", so every part of the frame
   below has to be real elements written to on a timer. Nothing here is an
   image, a canvas or a sprite sheet.

   The sample answer is deliberately mediocre — three fillers, a stall in the
   middle of a sentence, a "we" with no owner behind it — because the adaptive
   follow-up has to have something to bite on. */

const SIM_Q = "Tell me about a project where you missed the deadline. What slipped?";

type SimWord = {
  w: string;
  /** Boxed in ember where it was said, and counted. */
  fill?: true;
  /** Running pace once this word lands — what the Pace meter reads. */
  wpm: number;
  /**
   * Dead air *before* this word, in seconds. A full second or more is what the
   * longest-pause meter reports; anything shorter is just speech.
   */
  gap?: number;
};

const SIM_WORDS: readonly SimWord[] = [
  { w: "So", wpm: 96 },
  { w: "basically", fill: true, wpm: 104 },
  { w: "we", wpm: 112 },
  { w: "underestimated", wpm: 121 },
  { w: "the", wpm: 128 },
  { w: "migration,", wpm: 133 },
  { w: "um", fill: true, wpm: 138, gap: 0.6 },
  { w: "and", wpm: 141 },
  { w: "the", wpm: 144 },
  { w: "review", wpm: 147 },
  { w: "cycle", wpm: 150 },
  { w: "took", wpm: 153 },
  { w: "longer", wpm: 156 },
  { w: "because,", wpm: 158, gap: 1.4 },
  { w: "like", fill: true, wpm: 160 },
  { w: "coordination", wpm: 161 },
  { w: "between", wpm: 162 },
  { w: "the", wpm: 162 },
  { w: "two", wpm: 162 },
  { w: "teams…", wpm: 162 },
];

/**
 * What a screen reader gets, once, instead of the stream above. Every mutating
 * part of the frame is `aria-hidden`, because narrating a transcript as it is
 * typed is a live region that never stops talking — and the finished session is
 * the same session either way.
 */
const SIM_ALT =
  "Simulated Grill session with live transcription, flagged fillers, measured " +
  "delivery and an adaptive follow-up. A front-end behavioral round, question " +
  "four of eight. The interviewer asks: “Tell me about a project where you " +
  "missed the deadline. What slipped?” The answer comes back word by word — " +
  "“So basically we underestimated the migration, um and the review cycle took " +
  "longer because, like coordination between the two teams…” — with three " +
  "fillers flagged where they were said: basically, um, like. Delivery, " +
  "measured from the audio: 162 words per minute, longest pause 1.4 seconds, " +
  "3 fillers, 24.1 hertz of pitch variation. The session then asks its " +
  "follow-up: “You said ‘we’ — what did you own, and when did you know the " +
  "estimate was wrong?”";

/**
 * Resting heights for the five mic bars, as percentages. Index-based constants
 * for the same reason WAVE is (see above), and a resting height at all for the
 * same reason too: the animation only scales about these, so a stilled
 * equaliser is still an equaliser.
 */
const SIM_MIC = [46, 88, 60, 100, 68] as const;

/** Per character while the interviewer types — fast enough to be up in under
    two seconds, slow enough to read as someone typing it. */
const SIM_TYPE_MS = 22;
/** Beat between transcribed words, before any hesitation is added. */
const SIM_WORD_MS = 150;
/** What a second of the answer's dead air is worth in wall clock. Playing a
    1.4s stall at life size stalls the page too; this keeps it legible. */
const SIM_GAP_MS = 420;
/** How long a meter stays lit after the word that moved it. */
const SIM_FLASH_MS = 450;
/** How long the scored session holds before the loop starts over. */
const SIM_HOLD_MS = 3200;

/**
 * The session clock at first paint: 12:38 into the round. A constant rather
 * than a `Date` for the same reason WAVE is index maths — the server and the
 * client have to produce the same string or hydration tears.
 */
const SIM_CLOCK_START = 758;

function simClock(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Everything the run mutates, in one object so a step is one render. */
type SimState = {
  /** Characters of the question revealed. */
  typed: number;
  /** Words of the answer transcribed. */
  spoken: number;
  stamped: boolean;
  followed: boolean;
  pace: string;
  pause: string;
  fillers: number;
  pitch: string;
  status: string;
  chip: string;
  /** The verdict chip has landed on a verdict. */
  scored: boolean;
  /** The mic is hearing something — drives `.idle` on the frame. */
  live: boolean;
  /** 0–1, the bar under the frame. */
  progress: number;
  hitPause: boolean;
  hitFill: boolean;
};

const SIM_IDLE: SimState = {
  typed: 0,
  spoken: 0,
  stamped: false,
  followed: false,
  pace: "—",
  pause: "—",
  fillers: 0,
  pitch: "—",
  status: "Listening…",
  chip: "Scoring",
  scored: false,
  live: false,
  progress: 0,
  hitPause: false,
  hitFill: false,
};

/**
 * The finished session, and the state the server renders.
 *
 * Rendering the *end* rather than the empty frame is what makes three separate
 * problems go away at once: `prefers-reduced-motion` gets the completed session
 * with no timers and no post-mount repaint, a visitor whose JS never arrives
 * gets a session card instead of an empty box, and hydration has one
 * deterministic tree to match. The run resets to `SIM_IDLE` itself, off-screen,
 * before it types anything.
 */
const SIM_DONE: SimState = {
  typed: SIM_Q.length,
  spoken: SIM_WORDS.length,
  stamped: true,
  followed: true,
  pace: "162",
  pause: "1.4",
  fillers: 3,
  pitch: "24.1",
  status: "Q4 scored — receipts attached",
  chip: "Pressed",
  scored: true,
  live: true,
  progress: 1,
  hitPause: false,
  hitFill: false,
};

const REDUCE_Q = "(prefers-reduced-motion: reduce)";

/**
 * CSS can still an animation; only JS can decline to schedule a hundred timers
 * a lap, which is what the simulation costs. So the preference has to be read
 * in script as well as in the stylesheet.
 *
 * The lazy initialiser touches `window` and therefore returns a different value
 * on the server than on the client. That is safe *here* and would not be
 * elsewhere: this flag never reaches the rendered HTML. Both branches render
 * `SIM_DONE`; the flag only decides whether anything is allowed to take it
 * apart afterwards.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(REDUCE_Q).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(REDUCE_Q);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function SimZone() {
  const [sim, setSim] = useState<SimState>(SIM_DONE);
  const [clock, setClock] = useState(SIM_CLOCK_START);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    // Reduced motion is served by the markup that is already on screen. Nothing
    // is scheduled, so there is nothing to tear down; the `setSim` matters only
    // when the preference is switched on mid-visit, and is a no-op bail-out
    // otherwise because `SIM_DONE` is the same object the state already holds.
    if (reduced) {
      setSim(SIM_DONE);
      return;
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    let clockId: ReturnType<typeof setInterval> | undefined;
    let running = false;
    let visible = false;

    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };
    // Every timer the run owns goes through `later`, so one call empties the
    // whole lap — including the tail timer that would have started the next
    // one. Miss that and scrolling away leaves a loop running behind the
    // visitor for the rest of the visit.
    const clearAll = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };

    // The clock ticks only while the frame is on screen: a re-render a second
    // behind the visitor's back buys nothing.
    const startClock = () => {
      clockId ??= setInterval(() => setClock((c) => c + 1), 1000);
    };
    const stopClock = () => {
      if (clockId !== undefined) {
        clearInterval(clockId);
        clockId = undefined;
      }
    };

    /** One lap, scheduled up front as an offset table — the shape the reference
        used, and the reason a single `clearAll` can cancel a run mid-sentence. */
    const start = () => {
      if (running) return;
      running = true;
      setSim(SIM_IDLE);

      let t = 0;

      for (let i = 1; i <= SIM_Q.length; i += 1) {
        const typed = i;
        later(
          () => setSim((s) => ({ ...s, typed, progress: 0.02 + 0.16 * (typed / SIM_Q.length) })),
          t + i * SIM_TYPE_MS,
        );
      }
      // Half a second of the finished question sitting there before the mic
      // opens — the beat where a real candidate takes the question in.
      t += SIM_Q.length * SIM_TYPE_MS + 500;

      later(() => setSim((s) => ({ ...s, live: true, status: "Recording your answer…" })), t);

      let fillers = 0;
      SIM_WORDS.forEach((word, i) => {
        const gap = word.gap ?? 0;
        const long = gap >= 1;
        t += SIM_WORD_MS + gap * SIM_GAP_MS;
        if (word.fill) fillers += 1;
        const count = fillers;
        const at = t;
        later(
          () =>
            setSim((s) => ({
              ...s,
              spoken: i + 1,
              pace: String(word.wpm),
              fillers: count,
              progress: 0.18 + 0.5 * ((i + 1) / SIM_WORDS.length),
              ...(word.fill ? { hitFill: true } : null),
              ...(long ? { pause: gap.toFixed(1), hitPause: true } : null),
            })),
          at,
        );
        // Each flash is cleared on its own timer rather than by the next word:
        // "because," and "like" land 150ms apart, and the second must not cut
        // the first meter's flash short.
        if (word.fill) later(() => setSim((s) => ({ ...s, hitFill: false })), at + SIM_FLASH_MS);
        if (long) later(() => setSim((s) => ({ ...s, hitPause: false })), at + SIM_FLASH_MS);
      });

      t += 320;
      later(
        () =>
          setSim((s) => ({
            ...s,
            stamped: true,
            pitch: "24.1",
            status: "Answer captured — adapting…",
          })),
        t,
      );

      t += 750;
      later(
        () => setSim((s) => ({ ...s, followed: true, status: "Follow-up asked", progress: 0.82 })),
        t,
      );

      t += 1500;
      later(
        () =>
          setSim((s) => ({
            ...s,
            status: "Q4 scored — receipts attached",
            chip: "Pressed",
            scored: true,
            progress: 1,
          })),
        t,
      );

      t += SIM_HOLD_MS;
      later(() => {
        running = false;
        if (visible) start();
      }, t);
    };

    /*
     * Its own observer, not the page's.
     *
     * The reveal observer in `Landing` unobserves the moment it fires — that
     * one is choreography, and replaying it on the way back up is nausea. This
     * one is the opposite contract: the simulation has to restart every time it
     * comes back, and stop dead the moment it leaves, so the two cannot share.
     *
     * 0.35 rather than the reveal's 0.16 because a run that starts at the very
     * top edge of the frame has typed half the question before the frame is
     * actually readable.
     */
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting;
          if (visible) {
            startClock();
            start();
          } else {
            stopClock();
            clearAll();
            running = false;
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(frame);

    return () => {
      io.disconnect();
      clearAll();
      stopClock();
    };
  }, [reduced]);

  return (
    <section className="simzone">
      <div className="wrap">
        <p className="sim-label">
          <span className="sl">Live simulation — what a session looks like</span>
          <span>not a video — real DOM, running live</span>
        </p>

        <div className={`sim${sim.live ? "" : " idle"}`} ref={frameRef}>
          <p className="sr-only">{SIM_ALT}</p>

          <div className="sim-head" aria-hidden="true">
            <span>Frontend — behavioral</span>
            <span>Q 04 / 08 · {simClock(clock)}</span>
            <span className="rec">
              <i />
              REC
            </span>
          </div>

          <div className="sim-body" aria-hidden="true">
            <div className="sim-main">
              <div className="sim-q">
                <span className="qk">Interviewer</span>
                {/* The caret belongs to the question, not to the frame: it goes
                    when the mic opens, which is the moment the turn passes. */}
                <p className="qt">
                  {SIM_Q.slice(0, sim.typed)}
                  {!sim.live && <span className="caret" />}
                </p>
              </div>

              <div className="sim-a">
                <span className="ak">
                  <span className="mic">
                    {SIM_MIC.map((h, i) => (
                      <i key={i} style={{ "--h": `${h}%`, "--n": i } as CSSProperties} />
                    ))}
                  </span>
                  You — transcribed live
                </span>
                {/* One element per word, because each one has to be flaggable,
                    countable and timed on its own — which is the difference
                    between this and a video of the same thing. */}
                <p className="txt">
                  {sim.spoken === 0 ? (
                    <span className="tplace">
                      {sim.live ? "listening…" : "waiting for the question to land…"}
                    </span>
                  ) : null}
                  {SIM_WORDS.slice(0, sim.spoken).map((word, i) => (
                    <Fragment key={i}>
                      <span className={word.fill ? "w fmark" : "w"}>{word.w}</span>{" "}
                    </Fragment>
                  ))}
                  {sim.stamped && <span className="tstamp">[00:41]</span>}
                </p>
              </div>

              <div className={`sim-follow${sim.followed ? " on" : ""}`}>
                <span className="fl">Adaptive follow-up — built from your answer</span>
                {sim.followed ? (
                  <p>
                    You said “we” — what did <u>you</u> own, and when did you know the estimate was
                    wrong?
                  </p>
                ) : (
                  <p className="fpend">built once the answer is in…</p>
                )}
              </div>
            </div>

            <div className="sim-side">
              <div className="sim-meters">
                <div className="smet">
                  <span className="sk">Pace</span>
                  <div className="sv">
                    {sim.pace}
                    <i>wpm</i>
                  </div>
                </div>
                <div className={`smet${sim.hitPause ? " hit" : ""}`}>
                  <span className="sk">Longest pause</span>
                  <div className="sv">
                    {sim.pause}
                    <i>s</i>
                  </div>
                </div>
                <div className={`smet${sim.hitFill ? " hit" : ""}`}>
                  <span className="sk">Fillers</span>
                  <div className="sv">×{sim.fillers}</div>
                </div>
                <div className="smet">
                  <span className="sk">Pitch var</span>
                  <div className="sv">
                    {sim.pitch}
                    <i>Hz</i>
                  </div>
                </div>
              </div>
              <div className="sim-verdict">
                <span>{sim.status}</span>
                <span className={`vchip${sim.scored ? " on" : ""}`}>{sim.chip}</span>
              </div>
            </div>
          </div>

          <div className="sim-track" aria-hidden="true">
            <i style={{ width: `${(sim.progress * 100).toFixed(1)}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}

export { SimZone };
