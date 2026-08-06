"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/* ── fig. 01, the signal chain ─────────────────────────────────────────────
   The hero's second column: one session drawn as the path a signal takes. You
   bring a brief; Grill splits the answer into WORDS (a transcript, scored) and
   SOUND (the raw audio, measured); both land on a single verdict. That split is
   the product's whole argument — two different machines reading two different
   things — which is why the diagram is worth animating, and worth animating in
   the direction the data actually flows.

   The geometry below is the reference's, coordinate for coordinate. The wires
   are hand-aligned to the boxes they leave and enter; re-deriving them puts the
   pulses beside the wire instead of on it. */

type RigPhase = "listen" | "route" | "judge" | "verdict";

/** What the plate reads out while each stage has the floor. */
const RIG_PHASE_LABEL: Record<RigPhase, string> = {
  listen: "listening",
  route: "routing",
  judge: "scoring",
  verdict: "verdict",
};

/* The transcript, in three pieces: the middle one is the filler token and is
   painted red, and the typewriter has to fill all three strictly in order. */
const RIG_TR_HEAD = "“we underestimated the";
const RIG_TR_FILLER = "[um]";
const RIG_TR_TAIL = " migration — twice.”";
const RIG_TR_LEN = RIG_TR_HEAD.length + RIG_TR_FILLER.length + RIG_TR_TAIL.length;

/** Where every mic bar stands, so they scale off one baseline. */
const RIG_EQ_FLOOR = 88;

/**
 * The mic's five level bars. `n` staggers the animation; `h` is the height the
 * bar is drawn at, which is also the height it keeps when there is nothing to
 * stagger.
 *
 * The rest value is geometry rather than a base `transform` for a reason worth
 * writing down: `g-wave` declares `transform` in both its stops, and a keyframe's
 * declared value outranks the element's own for the whole run — a
 * `scaleY(var(--rest))` underneath it would never once be painted. Height is a
 * property the keyframe cannot reach, which is the same reason `.wave i` puts
 * its resting value there.
 */
const RIG_EQ = [
  { x: 262, n: 0, h: 27 },
  { x: 271, n: 1, h: 17 },
  { x: 280, n: 2, h: 30 },
  { x: 289, n: 3, h: 19 },
  { x: 298, n: 4, h: 24 },
] as const;

/**
 * The figures the readout flickers through before it settles, as fixed cycles
 * rather than Math.random(). The point is only that the numbers move while the
 * audio is being measured, and a constant keeps every value in this module
 * identical on the server and in the browser — same reasoning as WAVE above.
 */
const RIG_WPM_TICKS = ["141", "155", "147", "160", "138", "152", "144", "158"];
const RIG_HZ_TICKS = ["21.4", "26.8", "23.2", "27.5", "20.9", "25.1", "22.6", "24.8"];
const RIG_SCORE_ROLL = ["58", "81", "46", "77", "63", "88", "51", "69"];

/** Milestones of one cycle, in ms from the top of it. */
const RIG_ROUTE_AT = 2600;
const RIG_JUDGE_AT = 3600;
const RIG_VERDICT_AT = 5200;
const RIG_CYCLE = 7800;
const RIG_TYPE_MS = 26;
const RIG_TICK_MS = 110;
const RIG_ROLL_MS = 70;

type RigFrame = {
  phase: RigPhase;
  /** Characters of the transcript typed so far, across all three pieces. */
  typed: number;
  wpm: string;
  hz: string;
  score: string;
};

/**
 * The frame the server renders, and the one the rig settles on whenever it is
 * not running: a finished session, carrying the real figures rather than
 * zeroes.
 *
 * Two things ride on that. Hydration — the markup the server writes is exactly
 * what the client's first render produces, so there is nothing to mismatch. And
 * legibility — a reduced-motion visitor gets the complete diagram, score and
 * bars and stamp, rather than an empty rig waiting for a loop that will never
 * run.
 *
 * A module constant, so `setFrame(RIG_REST)` compares equal and re-renders
 * nothing.
 */
const RIG_REST: RigFrame = {
  phase: "verdict",
  typed: RIG_TR_LEN,
  wpm: "148",
  hz: "24.1",
  score: "72",
};

/** How much of one transcript piece shows, given the cycle's character count. */
function typedSlice(text: string, from: number, typed: number): string {
  return text.slice(0, Math.max(0, typed - from));
}

function HeroRig() {
  const [frame, setFrame] = useState<RigFrame>(RIG_REST);
  const [live, setLive] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  /**
   * Two gates on one piece of state. Motion preference is the hard one; being on
   * screen is the cheap one — this is a four-timer loop in the hero, and leaving
   * it ticking while someone reads the FAQ buys nothing.
   *
   * The media query is subscribed to rather than read once: turning the system
   * setting on mid-visit has to stop the rig, not wait for a reload.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onScreen = false;
    const sync = () => setLive(onScreen && !motion.matches);
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        onScreen = last.isIntersecting;
        sync();
      },
      { threshold: 0.2 },
    );
    io.observe(host);
    motion.addEventListener("change", sync);
    return () => {
      io.disconnect();
      motion.removeEventListener("change", sync);
    };
  }, []);

  /**
   * The phase machine. The reference drove this with four loose setTimeouts and
   * a getElementById per tick; the timeline is worth keeping, the reach into the
   * DOM is not — one frame of state renders the whole diagram.
   *
   * Every timer created here is owned by this effect and cleared in its return,
   * which is also what makes StrictMode's double-mount a no-op: the first pass
   * is torn down completely before the second one starts a cycle.
   */
  useEffect(() => {
    if (!live) {
      // Not running is a state, not a pause: leave the rig on the finished frame.
      setFrame(RIG_REST);
      return;
    }

    const pending: ReturnType<typeof setTimeout>[] = [];
    let typer: ReturnType<typeof setInterval> | undefined;
    let meter: ReturnType<typeof setInterval> | undefined;
    let roll: ReturnType<typeof setInterval> | undefined;

    const at = (ms: number, run: () => void) => {
      pending.push(setTimeout(run, ms));
    };
    const stop = () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
      if (typer) clearInterval(typer);
      if (meter) clearInterval(meter);
      if (roll) clearInterval(roll);
    };

    const cycle = () => {
      // Everything the last cycle scheduled has fired by now; the clear is for
      // the case where it has not, which is a tab that was throttled.
      stop();
      setFrame({ ...RIG_REST, phase: "listen", typed: 0 });

      let ch = 0;
      typer = setInterval(() => {
        ch += 1;
        const upto = ch;
        setFrame((f) => ({ ...f, typed: upto }));
        if (upto >= RIG_TR_LEN && typer) clearInterval(typer);
      }, RIG_TYPE_MS);

      at(RIG_ROUTE_AT, () => setFrame((f) => ({ ...f, phase: "route" })));

      at(RIG_JUDGE_AT, () => {
        setFrame((f) => ({ ...f, phase: "judge" }));
        let i = 0;
        meter = setInterval(() => {
          const step = i % RIG_WPM_TICKS.length;
          i += 1;
          setFrame((f) => ({
            ...f,
            wpm: RIG_WPM_TICKS[step] ?? RIG_REST.wpm,
            hz: RIG_HZ_TICKS[step] ?? RIG_REST.hz,
          }));
        }, RIG_TICK_MS);
      });

      at(RIG_VERDICT_AT, () => {
        if (meter) clearInterval(meter);
        setFrame((f) => ({ ...f, phase: "verdict", wpm: RIG_REST.wpm, hz: RIG_REST.hz }));
        let i = 0;
        roll = setInterval(() => {
          const next = RIG_SCORE_ROLL[i];
          i += 1;
          // Off the end of the roll is the settle: the score lands on the figure
          // the description promises.
          setFrame((f) => ({ ...f, score: next ?? RIG_REST.score }));
          if (next === undefined && roll) clearInterval(roll);
        }, RIG_ROLL_MS);
      });
    };

    cycle();
    const loop = setInterval(cycle, RIG_CYCLE);
    return () => {
      clearInterval(loop);
      stop();
    };
  }, [live]);

  return (
    <div
      ref={hostRef}
      className="rig"
      data-phase={frame.phase}
      role="img"
      aria-label="Diagram of a Grill session as a live signal chain: you bring a job description, résumé, or topic; Grill runs the interview and splits your answer into words, which are scored, and sound, which is measured from the raw audio; both converge into a verdict of 72 out of 100."
    >
      <div className="rig-marks" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* Plate furniture, and a status word that changes four times a cycle.
          `role="img"` on the wrapper already collapses this subtree for a screen
          reader; aria-hidden says so out loud for the ones that do not, and
          keeps the mutating word from ever being announced. */}
      <div className="rig-head" aria-hidden="true">
        <span>
          fig. 01 — <i>the signal chain</i>
        </span>
        <span className="rec">
          <span className="live-dot" />
          <b>{RIG_PHASE_LABEL[frame.phase]}</b>
        </span>
      </div>

      <svg viewBox="0 0 520 470" aria-hidden="true">
        {/* the wires */}
        <path className="wire" d="M135,134 L135,196" />
        <path className="wire" d="M240,134 L240,166 L385,166 L385,196" />
        <path className="wire" d="M56,196 L56,134" />
        <path className="wire" d="M135,304 L135,320 L260,320 L260,346" />
        <path className="wire" d="M385,304 L385,320 L262,320" />

        {/* what travels on them: `fin` runs into the processors, `fout` into the verdict */}
        <path className="flow fin" d="M135,134 L135,196" />
        <path className="flow fin f2" d="M240,134 L240,166 L385,166 L385,196" />
        <path className="flow fin f3" d="M56,196 L56,134" />
        <path className="flow fout" d="M135,304 L135,320 L260,320 L260,346" />
        <path className="flow fout f2" d="M385,304 L385,320 L262,320 L262,346" />

        <text transform="rotate(-90 22 178)" x="22" y="178" className="nd">
          follow-up ↺
        </text>

        {/* 01 · you bring */}
        <g className="gp gyou">
          <text className="stg" x="30" y="26">
            01 · you bring
          </text>
          <rect className="nbox" x="30" y="38" width="300" height="96" />
          <text className="nt" x="48" y="70">
            You
          </text>
          <g>
            {RIG_EQ.map((bar) => (
              <rect
                key={bar.x}
                className="eq"
                x={bar.x}
                y={RIG_EQ_FLOOR - bar.h}
                width="4"
                height={bar.h}
                style={{ "--n": bar.n } as CSSProperties}
              />
            ))}
          </g>
          <text className="nd" x="262" y="104">
            mic
          </text>
          <text className="tr" x="48" y="98">
            {typedSlice(RIG_TR_HEAD, 0, frame.typed)}
          </text>
          <text className="tr" x="48" y="116">
            <tspan className="tf">
              {typedSlice(RIG_TR_FILLER, RIG_TR_HEAD.length, frame.typed)}
            </tspan>
            <tspan>
              {typedSlice(RIG_TR_TAIL, RIG_TR_HEAD.length + RIG_TR_FILLER.length, frame.typed)}
            </tspan>
          </text>
        </g>

        {/* 02 · grill runs — the transcript on the left, the audio on the right */}
        <g className="gp gw">
          <text className="stg" x="30" y="186">
            02 · grill runs
          </text>
          <rect className="nbox hot" x="30" y="196" width="210" height="108" />
          <text className="nt" x="48" y="224">
            Words
          </text>
          <text className="ns" x="48" y="242">
            transcript → scored
          </text>
          <text className="nd" x="48" y="262">
            relevance
          </text>
          <rect className="jt" x="116" y="253" width="96" height="3" />
          <rect className="jm jm1" x="116" y="253" width="96" height="3" />
          <text className="nd" x="48" y="278">
            depth
          </text>
          <rect className="jt" x="116" y="269" width="96" height="3" />
          <rect className="jm jm2" x="116" y="269" width="96" height="3" />
          <text className="nd" x="48" y="294">
            structure
          </text>
          <rect className="jt" x="116" y="285" width="96" height="3" />
          <rect className="jm jm3" x="116" y="285" width="96" height="3" />
        </g>
        <g className="gp gs">
          <rect className="nbox hot" x="280" y="196" width="210" height="108" />
          <text className="nt" x="298" y="224">
            Sound
          </text>
          <text className="ns" x="298" y="242">
            raw audio → measured
          </text>
          <text className="nv" x="298" y="268">
            <tspan>{frame.wpm}</tspan>
            <tspan className="of" dx="3">
              wpm
            </tspan>
            <tspan className="of" dx="10">
              ·
            </tspan>
            <tspan dx="10">{frame.hz}</tspan>
            <tspan className="of" dx="3">
              Hz
            </tspan>
          </text>
          <polyline
            className="pl"
            points="298,286 310,280 320,289 334,278 346,287 358,281 370,290 384,279 396,286 410,282 422,289 436,280 448,286 460,283 470,285"
          />
        </g>

        {/* 03 · you get */}
        <g className="gp gv">
          <text className="stg" x="30" y="336">
            03 · you get
          </text>
          <rect className="nbox" x="30" y="346" width="460" height="96" />
          <text className="score" x="52" y="416">
            <tspan>{frame.score}</tspan>
            <tspan className="of" dx="6" dy="-2">
              /100
            </tspan>
          </text>
          <text className="ns" x="176" y="384">
            verdict — every claim
          </text>
          <text className="ns" x="176" y="402">
            cites your own words
          </text>
          <g className="stamp-g">
            <rect className="stampline" x="330" y="381" width="150" height="30" />
            <text className="stamptxt" x="343" y="400">
              Pressed — retry Q7
            </text>
          </g>
        </g>
      </svg>

      <div className="rig-foot" aria-hidden="true">
        <span>words → scored · audio → measured</span>
        <span>never the vibe</span>
      </div>
    </div>
  );
}

export { HeroRig };
