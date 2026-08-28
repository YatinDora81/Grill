"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";

const SIM_Q = "Tell me about a project where you missed the deadline. What slipped?";

type SimWord = {
  w: string;
  fill?: true;
  wpm: number;
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

const SIM_MIC = [46, 88, 60, 100, 68] as const;

const SIM_TYPE_MS = 22;
const SIM_WORD_MS = 150;
const SIM_GAP_MS = 420;
const SIM_FLASH_MS = 450;
const SIM_HOLD_MS = 3200;

const SIM_CLOCK_START = 758;

function simClock(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type SimState = {
  typed: number;
  spoken: number;
  stamped: boolean;
  followed: boolean;
  pace: string;
  pause: string;
  fillers: number;
  pitch: string;
  status: string;
  chip: string;
  scored: boolean;
  live: boolean;
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
    const clearAll = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };

    const startClock = () => {
      clockId ??= setInterval(() => setClock((c) => c + 1), 1000);
    };
    const stopClock = () => {
      if (clockId !== undefined) {
        clearInterval(clockId);
        clockId = undefined;
      }
    };

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
