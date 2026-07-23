"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { AuthModal, type AuthMode } from "./AuthModal";

/* ── content ──────────────────────────────────────────────────────────────
   Copy lives next to the markup it fills. All of it describes what the product
   actually does — the follow-ups are the interviewer's real register, and the
   sample receipt is the shape of a genuine delivery block. */

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
];

const STEPS = [
  {
    n: "01",
    t: "Set the brief",
    d: "Paste a job description, your résumé, or just a topic. Pick the level, the shape, and how many questions you can stomach.",
    tag: "~2 min setup",
  },
  {
    n: "02",
    t: "Sit in the hot seat",
    d: "Answer out loud or in writing, on camera if you dare. Every answer shapes the next question — including the follow-ups you’d rather dodge.",
    tag: "8 questions · voice or text",
  },
  {
    n: "03",
    t: "Read the honest report",
    d: "Verdicts grounded in your own words, question by question — plus delivery that was measured, not vibed: pace, pauses, fillers, pitch, energy.",
    tag: "receipts included",
  },
] as const;

const METRICS = [
  { k: "Pace", v: "148", u: "wpm", w: 74, d: 0.05 },
  { k: "Avg pause", v: "310", u: "ms", w: 58, d: 0.15 },
  { k: "Fillers", v: "6", u: "total", w: 32, d: 0.25 },
  { k: "Pitch variation", v: "24.1", u: "Hz", w: 66, d: 0.35 },
  { k: "Energy", v: "0.062", u: "rms", w: 51, d: 0.45 },
] as const;

const FEATURES = [
  {
    g: "[● REC]",
    t: "Voice or write",
    d: "Speak your answers or type them. Speech is transcribed word by word, with timings kept.",
  },
  {
    g: "[→ ?]",
    t: "Follow-ups that adapt",
    d: "No fixed script. Each answer decides what gets asked next — like a real interviewer who was actually listening.",
  },
  {
    g: "[▶ you]",
    t: "Watch yourself back",
    d: "Optional video, synced per question. See the face you make when the question lands.",
  },
  {
    g: "[“ ”]",
    t: "Scores with receipts",
    d: "Every verdict cites your own words back to you. No mystery grades, no vibes.",
  },
  {
    g: "[★]",
    t: "Star the killers",
    d: "Save the questions that got you and drill them again later, on your terms.",
  },
  {
    g: "[↻]",
    t: "Retry the same fire",
    d: "Re-run the exact brief and watch the numbers move. Progress you can point at.",
  },
] as const;

/**
 * The waveform horizon. Heights and phases are index-based maths on purpose:
 * the same 84 bars have to come out of the server render and the client
 * hydration, and Math.random() would guarantee they don't.
 */
const BARS = Array.from({ length: 84 }, (_, i) => {
  const h = 12 + Math.abs(Math.sin(i * 1.7) * 52) + (i % 5) * 4;
  return { h: Math.round(h), delay: (i * 137) % 1100, dur: 1500 + (i % 7) * 140 };
});

const TICKS: { left: string; label: ReactNode; optional: boolean }[] = [
  {
    left: "18%",
    label: (
      <>
        pace <b>148 wpm</b>
      </>
    ),
    optional: false,
  },
  {
    left: "42%",
    label: (
      <>
        pause <b>310 ms</b>
      </>
    ),
    optional: true,
  },
  {
    left: "64%",
    label: (
      <>
        filler <b>×6</b>
      </>
    ),
    optional: true,
  },
  {
    left: "86%",
    label: (
      <>
        pitch <b>24.1 Hz</b>
      </>
    ),
    optional: true,
  },
];

/** Where a signed-out visitor lands once they're in, absent a ?next=. */
const DEFAULT_NEXT = "/dashboard";

/**
 * Is this `?next=` somewhere on our own site?
 *
 * The old AuthForm tested `startsWith("/") && !startsWith("//")`. That is one
 * character short: browsers normalise a backslash to a slash while parsing, so
 * `/\evil.tld` passes the check and then resolves as the protocol-relative
 * `//evil.tld` — an open redirect out of our own sign-in. Reject any second
 * character that is a separator at all.
 */
function isInternalPath(next: string): boolean {
  return next.startsWith("/") && next[1] !== "/" && next[1] !== "\\";
}

export function Landing({ signedIn }: { signedIn: boolean }) {
  const [auth, setAuth] = useState<AuthMode | null>(null);
  const [closing, setClosing] = useState(false);
  const nextRef = useRef(DEFAULT_NEXT);
  const triggerRef = useRef<HTMLElement | null>(null);

  function openAuth(mode: AuthMode) {
    // Remembered so focus goes back where it came from on close.
    triggerRef.current = document.activeElement as HTMLElement | null;
    setAuth(mode);
  }

  // Stable identity: AuthModal's key/Esc listener takes this as a dependency,
  // and a new function each render would tear the listener down every time.
  const closeAuth = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setAuth(null);
      setClosing(false);
      triggerRef.current?.focus?.();
    }, 190);
  }, []);

  /**
   * Deep links: /?auth=login&next=/report/xyz. The auth gate (proxy.ts and every
   * signed-in server component) bounces here, and the old /login and /signup
   * URLs redirect here, so both have to be able to say which form to open and
   * where to go afterwards.
   *
   * Only internal paths are accepted for `next` — see `isInternalPath`. A
   * `?next=https://evil.tld` would otherwise make our own sign-in an open
   * redirect.
   *
   * Read off window.location rather than useSearchParams so this page needs no
   * Suspense boundary to prerender.
   */
  useEffect(() => {
    if (signedIn) return;
    const params = new URLSearchParams(window.location.search);
    const n = params.get("next");
    if (n && isInternalPath(n)) nextRef.current = n;
    const m = params.get("auth");
    if (m === "login" || m === "signup") setAuth(m);
  }, [signedIn]);

  // Reveal-on-scroll. Unobserved once it fires: this is choreography, not state,
  // and re-animating on the way back up is nausea, not delight.
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

  return (
    <div className="grill-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight" aria-hidden="true" />
      <div className="haze haze-a" aria-hidden="true" />
      <div className="haze haze-b" aria-hidden="true" />

      <header className="nav">
        <div className="wrap nav-in">
          <Link href="/" className="wordmark" aria-label="Grill home">
            grill<i>.</i>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it goes</a>
            <a href="#measured">Measured delivery</a>
            <a href="#record">On the record</a>
          </nav>
          {/* Signed in, there is nothing left to sell — one way back in. */}
          <div className="nav-cta">
            {signedIn ? (
              <Link href="/dashboard" className="btn btn-secondary btn-sm">
                Dashboard
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => openAuth("login")}
                >
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
            <p className="eyebrow rv" data-io style={{ "--d": "0s" } as CSSProperties}>
              <span className="live-dot" aria-hidden="true" />
              Composure under heat
            </p>
            <h1 className="h1 rv" data-io style={{ "--d": ".08s" } as CSSProperties}>
              Mock interviews
              <br />
              that tell you
              <br />
              the <span className="flame">truth.</span>
            </h1>
            <div className="hero-row">
              <p className="hero-sub rv" data-io style={{ "--d": ".16s" } as CSSProperties}>
                Most practice tools nod along. Grill asks the follow-up you were hoping to
                avoid, then scores <b>what you actually said</b> — and{" "}
                <b>how you actually sounded</b>.
              </p>
              <div className="hero-actions rv" data-io style={{ "--d": ".24s" } as CSSProperties}>
                <div className="hero-btns">
                  {signedIn ? (
                    <>
                      <Link href="/new" className="btn btn-primary btn-lg">
                        Start an interview
                      </Link>
                      <Link href="/dashboard" className="btn btn-secondary btn-lg">
                        Go to dashboard
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={() => openAuth("signup")}
                      >
                        Take the hot seat
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-lg"
                        onClick={() => openAuth("login")}
                      >
                        I have an account
                      </button>
                    </>
                  )}
                </div>
                <p className="hero-note">
                  job description · résumé · or just a topic — 8 questions, ~15 min
                </p>
              </div>
            </div>
          </div>

          {/* the signature: a waveform horizon, annotated with real metrics */}
          <div className="horizon rv" data-io style={{ "--d": ".34s" } as CSSProperties} aria-hidden="true">
            <div className="horizon-in">
              {TICKS.map((t, i) => (
                <div
                  key={i}
                  className={"tick" + (t.optional ? " optional" : "")}
                  style={{ left: t.left }}
                >
                  <span className="tick-label">{t.label}</span>
                  <span className="tick-line" />
                </div>
              ))}
              <div className="bars">
                {BARS.map((b, i) => (
                  <span
                    key={i}
                    className="bar"
                    style={{
                      height: b.h + "px",
                      animationDelay: b.delay + "ms",
                      animationDuration: b.dur + "ms",
                    }}
                  />
                ))}
              </div>
              <span className="horizon-caption">your last answer · measured live</span>
            </div>
          </div>

          {/* the follow-ups you'd rather dodge, on a loop */}
          <div className="reel" aria-hidden="true">
            <div className="reel-track">
              {[0, 1].map((set) => (
                <div className="reel-set" key={set}>
                  {FOLLOW_UPS.map((q, i) => (
                    <span className="reel-q" key={i}>
                      {q}
                      <span className="reel-sep">◆</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <p className="kicker rv" data-io>
              The ritual
            </p>
            <h2 className="h2 rv" data-io>
              How it goes
            </h2>
            <ol className="ledger">
              {STEPS.map((s) => (
                <li className="step rv" data-io key={s.n}>
                  <span className="step-n" aria-hidden="true">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="step-t">{s.t}</h3>
                    <p className="step-d">{s.d}</p>
                  </div>
                  <span className="step-tag">{s.tag}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="measured" style={{ paddingTop: 0 }}>
          <div className="wrap measure">
            <div className="measure-copy rv" data-io>
              <p className="kicker">The differentiator</p>
              <h2 className="h2">
                It <em>measures</em> delivery.
                <br />
                It doesn’t guess it.
              </h2>
              <p>
                Tone is never inferred from your transcript. <b>Pace, pauses and fillers</b>{" "}
                come from word-level timings; <b>pitch and energy</b> are read from the audio
                signal itself.
              </p>
              <p>If the numbers say you rushed — it’s because you rushed.</p>
            </div>
            <div
              className="receipt rv"
              data-io
              role="img"
              aria-label="Sample delivery report: pace 148 words per minute, average pause 310 milliseconds, 6 fillers, pitch variation 24.1 hertz, energy 0.062"
            >
              <div className="receipt-head">
                <span className="receipt-label">Delivery — Q4 of 8</span>
                <span className="chip chip-good">Composed</span>
              </div>
              {METRICS.map((m) => (
                <div className="metric" key={m.k}>
                  <div className="metric-row">
                    <span className="metric-k">{m.k}</span>
                    <span className="metric-v">
                      {m.v}
                      <small>{m.u}</small>
                    </span>
                  </div>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{ width: m.w + "%", animationDelay: m.d + "s" }}
                    />
                  </div>
                </div>
              ))}
              <p className="receipt-foot">
                <b>pace &amp; pauses</b> ← word-level timings&ensp;·&ensp;<b>pitch &amp; energy</b>{" "}
                ← raw audio&ensp;·&ensp;never the transcript
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="record" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <p className="kicker rv" data-io>
              On the record
            </p>
            <h2 className="h2 rv" data-io>
              Everything you said,
              <br />
              held against you. <em>Kindly.</em>
            </h2>
            <div className="feature-grid">
              {FEATURES.map((f) => (
                <div className="cell rv" data-io key={f.t}>
                  <span className="cell-glyph" aria-hidden="true">
                    {f.g}
                  </span>
                  <h3 className="cell-t">{f.t}</h3>
                  <p className="cell-d">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="final">
          <div className="final-glow" aria-hidden="true" />
          <div className="wrap">
            <p className="kicker rv" data-io style={{ justifyContent: "center" }}>
              No surprises on the day
            </p>
            <h2 className="h1 rv" data-io>
              Find out <span className="flame">before they do.</span>
            </h2>
            <p className="final-sub rv" data-io>
              free to start · bring a job description and fifteen minutes
            </p>
            <div className="final-btns rv" data-io>
              {signedIn ? (
                <Link href="/new" className="btn btn-primary btn-lg">
                  Start an interview
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => openAuth("signup")}
                >
                  Take the hot seat
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-in">
          <Link href="/" className="wordmark" style={{ fontSize: 20 }}>
            grill<i>.</i>
          </Link>
          <nav className="footer-links" aria-label="Footer">
            {signedIn ? (
              <Link href="/dashboard">Dashboard</Link>
            ) : (
              <>
                <button type="button" className="linklike" onClick={() => openAuth("login")}>
                  Log in
                </button>
                <button type="button" className="linklike" onClick={() => openAuth("signup")}>
                  Start free
                </button>
              </>
            )}
          </nav>
          <span className="footer-note">practice under heat</span>
        </div>
      </footer>

      {/* Never mounted for a signed-in visitor: there is nothing to sign into. */}
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
