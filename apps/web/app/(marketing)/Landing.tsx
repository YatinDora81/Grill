"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthModal, type AuthMode } from "./AuthModal";
import { HeroRig } from "./HeroRig";
import { SimZone } from "./SimZone";

const NAV = [
  { href: "#how", label: "How it goes" },
  { href: "#measured", label: "Measurement" },
  { href: "#modes", label: "Modes" },
  { href: "#faq", label: "FAQ" },
] as const;

const STEPS = [
  {
    n: "01",
    t: "Paste the brief",
    d: "A job description, your résumé, or just a topic. Pick the level and the shape.",
    tag: "~2 min setup",
  },
  {
    n: "02",
    t: "Take the heat",
    d: "Answer out loud or in writing, on camera if you dare. Every answer shapes the next question.",
    tag: "8 questions · voice or text",
  },
  {
    n: "03",
    t: "Read the verdict",
    d: "Scores grounded in your own words, plus delivery that was measured — not vibed.",
    tag: "receipts included",
  },
] as const;

const CLAIMS = [
  { k: "Input", v: "JD / résumé / topic" },
  { k: "Answer by", v: "voice · text · camera" },
  { k: "Transcription", v: "word-level, timings kept" },
  { k: "Video", v: "optional, synced per question" },
] as const;

const FOLLOW_UPS = [
  "Why that tradeoff?",
  "What broke in production?",
  "Walk me through the part you skipped.",
  "You said “we” — what did you do?",
  "Why is that the right metric?",
  "What happens at ten times the load?",
  "Where did the estimate slip?",
  "What would your teammate say went wrong?",
  "Defend the decision you’d undo.",
  "And if the interviewer pushes back?",
] as const;

const METRICS = [
  { n: "148", u: "wpm — pace", d: "From word-level timings in your transcription." },
  { n: "310", u: "ms — avg pause", d: "Every silence is on the record, to the millisecond." },
  { n: "×6", u: "fillers — counted", d: "Um, like, basically. Flagged where you said them." },
  { n: "24.1", u: "Hz — pitch var", d: "Read from the raw audio signal itself." },
] as const;

const SOURCES: ReactNode[] = [
  <>
    <b>Pace &amp; pauses</b> ← word-level timings
  </>,
  <>
    <b>Pitch &amp; energy</b> ← raw audio
  </>,
  <>
    <b>Never</b> ← <i>the transcript</i>
  </>,
];

const MODES = [
  {
    k: "M—01",
    kd: "a real posting",
    t: "JD run",
    d: (
      <>
        Paste the job you’re actually going for. It gets probed <b>against your résumé</b> — gap by
        gap.
      </>
    ),
  },
  {
    k: "M—02",
    kd: "the whole thing",
    t: "The full arc",
    d: (
      <>
        The shape a real interviewer runs — opening to <b>“any questions for us?”</b>
      </>
    ),
    stages: ["Intro", "Résumé", "Concepts", "Depth", "Closing"],
  },
  {
    k: "M—03",
    kd: "bring your repo",
    t: "Project",
    d: (
      <>
        Grilled on something <b>you built</b>. Paste a write-up — or import a repo and defend the
        commits.
      </>
    ),
  },
  {
    k: "M—04",
    kd: "revenge round",
    t: "Weak spots",
    d: (
      <>
        Re-asks the questions <b>you scored worst on</b>, mixed with fresh ones. The rematch you owe
        yourself.
      </>
    ),
  },
  {
    k: "M—05",
    kd: "name a subject",
    t: "Topic only",
    d: (
      <>
        Distributed systems. React internals. Anything. Résumé <b>deliberately ignored</b>.
      </>
    ),
  },
  {
    k: "M—06",
    kd: "how you work",
    t: "Culture only",
    d: (
      <>
        Conflict, failure, judgement calls. <b>No tech</b> — just the questions that decide the
        offer.
      </>
    ),
  },
] as const;

const PROTOCOL = [
  {
    n: "P—01",
    t: "Adaptive follow-ups",
    d: "No fixed script. Each answer decides what gets asked next.",
  },
  {
    n: "P—02",
    t: "Voice or text",
    d: "Speak or type. Speech is transcribed word by word, with timings kept.",
  },
  {
    n: "P—03",
    t: "Watch yourself back",
    d: "Optional video, synced per question. See the face you make when the question lands.",
  },
  {
    n: "P—04",
    t: "Verdicts with receipts",
    d: "Every score cites your own words back to you. No mystery grades.",
  },
  {
    n: "P—05",
    t: "Star the killers",
    d: "Save the questions that got you and drill them again later, on your terms.",
  },
  {
    n: "P—06",
    t: "Rerun the exact brief",
    d: "Repeat the same fire and watch your numbers move. Progress you can point at.",
  },
] as const;

const FAQ: { q: string; a: ReactNode; open?: boolean }[] = [
  {
    q: "Is it actually free?",
    a: (
      <>
        Free to start — <b>eight questions, no card.</b> Bring a job description and fifteen
        minutes; that’s the whole price of finding out.
      </>
    ),
  },
  {
    q: "Will it judge my tone from my words?",
    open: true,
    a: (
      <>
        <b>Never — this is the house rule.</b> Pace and pauses come from word-level timings. Pitch
        and energy are read from the raw audio signal. If tonality can’t be measured, it is reported
        as missing — <b>not guessed from the transcript.</b>
      </>
    ),
  },
  {
    q: "What happens to my recordings?",
    a: (
      <>
        <b>They’re yours, scoped to your account</b> — every session and report query is tied to
        your user id. Videos carry a visible expiry date, and audio is fetched on demand only when
        you press play.
      </>
    ),
  },
  {
    q: "Do I need a camera?",
    a: (
      <>
        No. Answer by <b>voice or text</b> — the camera is optional, synced per question, and exists
        for one reason: watching yourself back is the fastest coach there is.
      </>
    ),
  },
  {
    q: "Will a rerun repeat the same questions?",
    a: (
      <>
        Not unless you ask it to. Every question you’ve already faced becomes a{" "}
        <b>do-not-reuse list</b> — the same résumé never produces the same interview twice.
      </>
    ),
  },
];

const WAVE = Array.from(
  { length: 44 },
  (_, i) => 24 + Math.round(Math.abs(Math.sin(i * 1.7)) * 62) + (i % 5) * 2,
);

const DEFAULT_NEXT = "/dashboard";

function isInternalPath(next: string): boolean {
  return next.startsWith("/") && next[1] !== "/" && next[1] !== "\\";
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Landing({ signedIn }: { signedIn: boolean }) {
  const [auth, setAuth] = useState<AuthMode | null>(null);
  const [closing, setClosing] = useState(false);
  const [mqPaused, setMqPaused] = useState(false);
  const nextRef = useRef(DEFAULT_NEXT);
  const triggerRef = useRef<HTMLElement | null>(null);

  function openAuth(mode: AuthMode) {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setAuth(mode);
  }

  const closeAuth = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setAuth(null);
      setClosing(false);
      triggerRef.current?.focus?.();
    }, 190);
  }, []);

  useEffect(() => {
    if (signedIn) return;
    const params = new URLSearchParams(window.location.search);
    const n = params.get("next");
    if (n && isInternalPath(n)) nextRef.current = n;
    const m = params.get("auth");
    if (m === "login" || m === "signup" || m === "forgot") setAuth(m);
  }, [signedIn]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("io-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.16 },
    );
    document.querySelectorAll("[data-io]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const hotSeat = signedIn ? (
    <Link href="/new" className="btn btn-primary">
      Start an interview
      <Arrow />
    </Link>
  ) : (
    <button type="button" className="btn btn-primary" onClick={() => openAuth("signup")}>
      Take the hot seat
      <Arrow />
    </button>
  );

  return (
    <div className="grill-root">
      <div className="grain" aria-hidden="true" />

      <header className="lnav">
        <div className="wrap lnav-in">
          <Link href="/" className="wordmark" aria-label="Grill home">
            grill<i>.</i>
            <small>AI mock interviews</small>
          </Link>
          <nav className="lnav-links" aria-label="Primary">
            {NAV.map((n) => (
              <a href={n.href} key={n.href}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="lnav-right">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-secondary btn-sm">
                Dashboard
              </Link>
            ) : (
              <>
                <button type="button" className="linklike login" onClick={() => openAuth("login")}>
                  Log in
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => openAuth("signup")}
                >
                  Start free
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap">
            <p className="hero-kick rv" data-io style={{ "--d": "0s" } as CSSProperties}>
              <span>
                <b>Grill</b> — AI mock interview simulator
              </span>
              <span className="live">
                <span className="live-dot" aria-hidden="true" />
                answer by voice · text · camera
              </span>
              <span>~15 min per session</span>
            </p>

            <div className="hero-grid">
              <div>
                <h1
                  className="disp hero-h1"
                  data-io
                  aria-label="The interview before the interview."
                >
                  <span className="lift">
                    <span>The interview</span>
                  </span>
                  <span className="lift l2 row2">
                    <span>
                      <span className="hollow">before</span> the
                    </span>
                  </span>
                  <span className="lift l3">
                    <span>
                      interview<span className="red">.</span>
                    </span>
                  </span>
                </h1>

                <p className="hero-sub rv" data-io style={{ "--d": ".24s" } as CSSProperties}>
                  It asks the follow-up you were hoping to avoid, then scores{" "}
                  <b>what you said</b> and measures <b>how you sounded</b> — pace, pauses,
                  fillers, pitch, energy. From the audio. Never the vibe.
                </p>

                <div className="hero-cta rv" data-io style={{ "--d": ".32s" } as CSSProperties}>
                  {hotSeat}
                  <span className="meta">free · 8 questions · no card</span>
                </div>

                <p className="rv mt-5" data-io style={{ "--d": ".38s" } as CSSProperties}>
                  <Link
                    href="/sample"
                    className="text-[0.88rem] text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ember"
                  >
                    or read a sample verdict →
                  </Link>
                </p>
              </div>

              <HeroRig />
            </div>
          </div>
        </section>

        <SimZone />

        <div className="strip" id="how">
          <div className="wrap strip-grid">
            {STEPS.map((s) => (
              <div className="stepc rv" data-io key={s.n}>
                <span className="sn">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <span className="sm">{s.tag}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="sect" id="listens">
          <div className="wrap">
            <div className="rail">
              <span>01</span>
              <span className="r-name">Adaptive</span>
              <span>no fixed script</span>
            </div>
            <div className="stmt-grid">
              <div className="stmt-copy rv" data-io>
                <h2 className="disp stmt-h">
                  No <span className="hollow">script</span>
                  <span className="red">.</span>
                  <br />
                  It <span className="red">listens.</span>
                </h2>
                <p>
                  There is no fixed question list. Every answer decides what gets asked next — and
                  the vaguer the answer, the harder the next question. <b>This is the mechanic</b>,
                  not a feature bullet.
                </p>
              </div>
              <div className="claims rv" data-io>
                {CLAIMS.map((c) => (
                  <div key={c.k}>
                    <span className="k">{c.k}</span>
                    <span className="v">{c.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="press">
          <div className="wrap">
            <div className="rail">
              <span>02</span>
              <span className="r-name">Pressure</span>
              <span className="mq-ctl">
                what it asks back
                <button
                  type="button"
                  className="mq-toggle"
                  aria-pressed={mqPaused}
                  onClick={() => setMqPaused((p) => !p)}
                >
                  {mqPaused ? "Play" : "Pause"}
                </button>
              </span>
            </div>
          </div>
          <div className="mq" data-paused={mqPaused ? "" : undefined}>
            <div className="mq-track">
              {[0, 1].map((set) => (
                <div className="mq-set" key={set} aria-hidden={set === 1 ? true : undefined}>
                  {FOLLOW_UPS.map((q, i) => (
                    <span className={i % 2 ? "hollow" : undefined} key={q}>
                      {q}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="wrap">
            <p className="press-note rv" data-io>
              Every answer decides the next question —{" "}
              <i>like an interviewer who was actually listening.</i>
            </p>
          </div>
        </section>

        <section className="sect" id="measured">
          <div className="wrap">
            <div className="rail">
              <span>03</span>
              <span className="r-name">Measurement</span>
              <span>from audio</span>
            </div>
            <h2 className="disp meas-h" data-io aria-label="Measured. Not vibes.">
              <span className="lift">
                <span>
                  Measured<span className="red">.</span>
                </span>
              </span>
              <span className="lift l2">
                <span>
                  Not <span className="hollow">vibes</span>
                  <span className="red">.</span>
                </span>
              </span>
            </h2>
            <div className="rv" data-io>
              <div className="wave" aria-hidden="true">
                {WAVE.map((h, i) => (
                  <i key={i} style={{ "--h": h + "%", "--n": i } as CSSProperties} />
                ))}
              </div>
              <div className="bignum">
                {METRICS.map((m) => (
                  <div className="bn" key={m.u}>
                    <div className="n">{m.n}</div>
                    <span className="u">{m.u}</span>
                    <p className="d">{m.d}</p>
                  </div>
                ))}
              </div>
              <div className="meas-src">
                {SOURCES.map((s, i) => (
                  <div className="msrc" key={i}>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sect" id="modes">
          <div className="wrap">
            <div className="rail">
              <span>04</span>
              <span className="r-name">Modes</span>
              <span>six shapes of fire</span>
            </div>
            <div className="modegrid rv" data-io>
              {MODES.map((m) => (
                <div className="mode" key={m.k}>
                  <span className="mk">
                    <i>{m.k}</i> · {m.kd}
                  </span>
                  <h3>{m.t}</h3>
                  <p>{m.d}</p>
                  {"stages" in m && (
                    <div className="mstage">
                      {m.stages.map((s, i) => (
                        <span key={s}>
                          {i > 0 && <i>→ </i>}
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="modes-note rv" data-io>
              <b>Or blend freely</b> — résumé + topic + culture in one interview that moves between
              all three.
            </p>
          </div>
        </section>

        <section className="sect" id="protocol">
          <div className="wrap">
            <div className="rail">
              <span>05</span>
              <span className="r-name">Protocol</span>
              <span>what you get</span>
            </div>
            <div className="tbl">
              {PROTOCOL.map((p) => (
                <div className="trow rv" data-io key={p.n}>
                  <span className="tn">{p.n}</span>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                  <span className="ar" aria-hidden="true">
                    <Arrow />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="sect" id="faq">
          <div className="wrap">
            <div className="rail">
              <span>06</span>
              <span className="r-name">Objections</span>
              <span>handled here, not on the day</span>
            </div>
            <div className="faq rv" data-io>
              {FAQ.map((f) => (
                <details className="faqi" key={f.q} open={f.open}>
                  <summary>
                    <h3>{f.q}</h3>
                    <span className="fc" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="fa">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="closer">
          <div className="wrap">
            <div className="rail">
              <span>07</span>
              <span className="r-name">Verdict</span>
              <span>no surprises on the day</span>
            </div>
            <h2 className="disp vh" data-io aria-label="Find out before they do.">
              <span className="lift">
                <span>Find out</span>
              </span>
              <span className="lift l2 row2">
                <span>
                  <span className="hollow">before</span> they do<span className="red">.</span>
                </span>
              </span>
            </h2>
            <div className="closer-foot rv" data-io>
              <p className="meta">
                Free to start · bring a job description
                <br />
                <i>and fifteen minutes.</i>
              </p>
              {hotSeat}
            </div>
          </div>
        </section>
      </main>

      <footer className="lfooter">
        <div className="wrap foot-top">
          <Link href="/" className="wordmark" aria-label="Grill home">
            grill<i>.</i>
          </Link>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <nav className="foot-links" aria-label="Footer">
              {NAV.map((n) => (
                <a href={n.href} key={n.href}>
                  {n.label}
                </a>
              ))}
              <Link href="/tools/resume-vs-jd">Résumé vs JD</Link>
              {signedIn ? (
                <Link href="/dashboard">Dashboard</Link>
              ) : (
                <button type="button" onClick={() => openAuth("login")}>
                  Log in
                </button>
              )}
            </nav>
            <ThemeToggle className="w-auto" />
          </div>
        </div>
        <div className="wrap foot-bottom">
          <span>Grill — AI mock interviews</span>
          <span>Practice under pressure</span>
          <span>No script · receipts included</span>
        </div>
      </footer>

      {!signedIn && auth && (
        <AuthModal
          mode={auth}
          next={nextRef.current}
          closing={closing}
          onSwitch={setAuth}
          onClose={closeAuth}
        />
      )}
    </div>
  );
}
