"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";

export type AuthMode = "login" | "signup" | "forgot";

function ModalSlug({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] tracking-[0.22em] uppercase text-ink-muted">
      <span className="text-ember" aria-hidden="true">
        /{" "}
      </span>
      {children}
    </span>
  );
}

function ModeTab({
  active,
  divider,
  onClick,
  children,
}: {
  active: boolean;
  divider?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors " +
        (divider ? "border-l border-line " : "") +
        (active ? "bg-ink font-semibold text-paper" : "text-ink-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

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
  const isForgot = mode === "forgot";
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLButtonElement>(null);

  const pwPct = Math.min((password.length / 12) * 100, 100);
  const pwOk = password.length >= 8;

  useEffect(() => {
    if (!sent) firstFieldRef.current?.focus();
  }, [mode, sent]);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

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
        if (!dialogRef.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
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

  function switchMode(to: AuthMode) {
    setError("");
    setShowPw(false);
    setSent(false);
    onSwitch(to);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isForgot) {
      if (!email.trim()) {
        setError("Enter the email on your account.");
        return;
      }
    } else if (!email.trim() || !password) {
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
      if (isForgot) {
        await apiPost<{ ok: true }>("/api/auth/forgot-password", { email });
        setSent(true);
        setBusy(false);
        return;
      }
      await apiPost<{ user: User }>(`/api/auth/${mode}`, {
        email,
        password,
        ...(isSignup && name.trim() ? { name: name.trim() } : {}),
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className={"overlay" + (closing ? " closing" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-top">
          <ModalSlug>{isForgot ? "Grill — reset" : "Grill — auth"}</ModalSlug>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {!sent && !isForgot && (
          <div className="mt-5 grid grid-cols-2 border border-line">
            <ModeTab active={!isSignup} onClick={() => switchMode("login")}>
              Log in
            </ModeTab>
            <ModeTab divider active={isSignup} onClick={() => switchMode("signup")}>
              Sign up
            </ModeTab>
          </div>
        )}

        <div className="modal-head" key={mode + String(sent)}>
          <h2 className="modal-h" id="auth-title">
            {sent ? (
              <>
                Check your <span className="text-ember">inbox.</span>
              </>
            ) : isForgot ? (
              <>
                Lost the <span className="text-ember">password.</span>
              </>
            ) : isSignup ? (
              <>
                Take the <span className="text-ember">hot seat.</span>
              </>
            ) : (
              <>
                Back to the <span className="text-ember">room.</span>
              </>
            )}
          </h2>
          <p className="modal-sub">
            {sent
              ? "One link, sent to the address you gave — if there's an account behind it."
              : isForgot
                ? "Give us the email on the account and we'll send a link to set a new password."
                : isSignup
                  ? "Make an account and run your first interview in a couple of minutes."
                  : "Log in to pick up where you left off — your reports are waiting."}
          </p>
        </div>

        {sent ? (
          <div className="mform">
            <p className="modal-sub">
              If <b>{email.trim()}</b> is on an account, a link to set a new password is on its way.
              If it isn&rsquo;t, nothing was sent — we don&rsquo;t say which, on purpose.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              ref={sentRef}
              onClick={() => switchMode("login")}
            >
              Back to log in
            </button>
            <p className="modal-sub">
              The link works once, and not for long. Check spam before{" "}
              <button type="button" className="link-ember" onClick={() => setSent(false)}>
                trying another address
              </button>
              .
            </p>
          </div>
        ) : (
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

            {!isForgot && (
              <div>
                <div className="field-row">
                  <label className="label" htmlFor="m-password">
                    Password
                  </label>
                  {isSignup ? (
                    <span className={"hint" + (pwOk ? " ok" : "")}>
                      {pwOk ? "that’ll do" : "at least 8 characters"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="hint linklike hint-link"
                      onClick={() => switchMode("forgot")}
                    >
                      forgot password?
                    </button>
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
            )}

            {error && (
              <p className="error-note" role="alert" key={error}>
                <span aria-hidden="true">!</span> {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy
                ? "One moment…"
                : isForgot
                  ? "Send the link"
                  : isSignup
                    ? "Create account"
                    : "Log in"}
            </button>
          </form>
        )}

        {!sent && (
          <p className="modal-swap">
            {isForgot ? (
              <>
                Remembered it?{" "}
                <button type="button" className="link-ember" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </>
            ) : isSignup ? (
              <>
                Already have an account?{" "}
                <button type="button" className="link-ember" onClick={() => switchMode("login")}>
                  Log in
                </button>
              </>
            ) : (
              <>
                New here?{" "}
                <button type="button" className="link-ember" onClick={() => switchMode("signup")}>
                  Create one
                </button>
              </>
            )}
          </p>
        )}

        <p className="modal-fine">
          {isForgot ? (
            <>
              <b>one link</b> · single use · esc closes this
            </>
          ) : (
            <>
              <b>free to start</b> · no card · esc closes this
            </>
          )}
        </p>
      </div>
    </div>
  );
}
