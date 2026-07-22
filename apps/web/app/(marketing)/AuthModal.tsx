"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";

export type AuthMode = "login" | "signup";

/**
 * The burner mark — an Archimedean spiral, generated once at module load.
 *
 * Index-based maths rather than anything random, so the path string is
 * byte-identical on the server and on the client and hydration doesn't complain.
 */
const SPIRAL = (() => {
  const turns = 3.4;
  const a = 4;
  const b = 8.1;
  const cx = 200;
  const cy = 200;
  let d = "";
  for (let t = 0; t <= turns * 2 * Math.PI; t += 0.07) {
    const r = a + b * t;
    d +=
      (d ? " L" : "M") +
      (cx + r * Math.cos(t)).toFixed(1) +
      " " +
      (cy + r * Math.sin(t)).toFixed(1);
  }
  return d;
})();

function MiniCoil() {
  return (
    <svg
      className="mini-coil"
      viewBox="0 0 400 400"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="coilGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" className="g-stop-core" />
          <stop offset="30%" className="g-stop-glow" />
          <stop offset="65%" className="g-stop-hot" />
          <stop offset="100%" className="g-stop-ember" />
        </radialGradient>
      </defs>
      <path d={SPIRAL} fill="none" stroke="url(#coilGrad)" strokeWidth="20" strokeLinecap="round" />
      <circle cx="200" cy="200" r="9" fill="#ffdca8" />
    </svg>
  );
}

/**
 * Log in / sign up, in a dialog over the landing page.
 *
 * Both endpoints set the session cookie and return { user }, so the only real
 * differences between the two modes are the copy and the name field — the same
 * shape the old /login and /signup routes shared, now without the page load.
 *
 * `next` is where the auth gate wanted to send us. The caller has already
 * checked it is an internal path; an attacker-supplied ?next=https://evil.tld
 * would otherwise turn our own sign-in into an open redirect.
 */
export function AuthModal({
  mode,
  next,
  closing,
  onSwitch,
  onClose,
}: {
  mode: AuthMode;
  next: string;
  closing: boolean;
  onSwitch: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const isSignup = mode === "signup";
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const pwPct = Math.min((password.length / 12) * 100, 100);
  const pwOk = password.length >= 8;

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [mode]);

  // Esc closes, Tab cycles inside the dialog, and the page underneath doesn't
  // scroll away behind the scrim.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const list = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>("button, input, a[href]"),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (!list.length) return;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function switchMode() {
    setError("");
    setShowPw(false);
    onSwitch(isSignup ? "login" : "signup");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // `noValidate` on the form, so these two are the whole client-side check —
    // the server is still the one that decides.
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (isSignup && !pwOk) {
      setError("Password needs at least 8 characters.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await apiPost<{ user: User }>(`/api/auth/${mode}`, {
        email,
        password,
        ...(isSignup && name.trim() ? { name: name.trim() } : {}),
      });
      // Left busy on purpose: the navigation is the next thing that happens, and
      // a button that springs back to "Log in" mid-redirect invites a second submit.
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div
      className={"overlay" + (closing ? " closing" : "")}
      // mousedown, not click: a drag that starts inside the dialog and ends on
      // the scrim (selecting text, say) would otherwise close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" ref={dialogRef}>
        <div className="modal-top">
          <MiniCoil />
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {/* `key={mode}` replays the entrance when the two modes swap, so the
            switch reads as a change of subject rather than a text diff. */}
        <div className="modal-head" key={mode}>
          <h2 className="modal-h" id="auth-title">
            {isSignup ? (
              <>
                Take the <span className="flame">hot seat.</span>
              </>
            ) : (
              <>
                Back to the <span className="flame">room.</span>
              </>
            )}
          </h2>
          <p className="modal-sub">
            {isSignup
              ? "Make an account and run your first interview in a couple of minutes."
              : "Log in to pick up where you left off — your reports are waiting."}
          </p>
        </div>

        <form className="mform" onSubmit={onSubmit} noValidate>
          {isSignup && (
            <div>
              <div className="field-row">
                <label className="label" htmlFor="m-name">
                  Name
                </label>
                <span className="hint">optional</span>
              </div>
              <input
                id="m-name"
                name="name"
                className="input"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                ref={firstFieldRef}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div>
            <div className="field-row">
              <label className="label" htmlFor="m-email">
                Email
              </label>
            </div>
            <input
              id="m-email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              ref={isSignup ? undefined : firstFieldRef}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
          </div>

          <div>
            <div className="field-row">
              <label className="label" htmlFor="m-password">
                Password
              </label>
              {isSignup && (
                <span className={"hint" + (pwOk ? " ok" : "")}>
                  {pwOk ? "that’ll do" : "at least 8 characters"}
                </span>
              )}
            </div>
            <div className="input-wrap">
              <input
                id="m-password"
                name="password"
                className="input has-toggle"
                required
                type={showPw ? "text" : "password"}
                minLength={isSignup ? 8 : undefined}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "hide" : "show"}
              </button>
            </div>
            {isSignup && (
              <div className="pw-meter" aria-hidden="true">
                <div
                  className={"pw-meter-fill" + (pwOk ? " ok" : "")}
                  style={{ width: pwPct + "%" }}
                />
              </div>
            )}
          </div>

          {/* `key={error}` so a repeated failure shakes again instead of sitting
              there looking like nothing happened. */}
          {error && (
            <p className="error-note" role="alert" key={error}>
              <span aria-hidden="true">!</span> {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "One moment…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="modal-swap">
          {isSignup ? "Already have an account? " : "New here? "}
          <button type="button" className="link-ember" onClick={switchMode}>
            {isSignup ? "Log in" : "Create one"}
          </button>
        </p>

        <p className="modal-fine">
          <b>free to start</b> · no card · esc closes this
        </p>
      </div>
    </div>
  );
}
