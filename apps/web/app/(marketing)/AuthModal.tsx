"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";

export type AuthMode = "login" | "signup" | "forgot";

/**
 * The dialog's own slug line, in the shape every screen header now uses:
 * a red slash, then what this thing is. It replaced the spinning burner coil —
 * the coil was a glowing gradient in a system that no longer has any, and a
 * dialog that announces itself in one mono line is what the reference does.
 */
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

/**
 * Log in / sign up, as a two-up segmented switch.
 *
 * Plain buttons with `aria-pressed`, not `role="tab"`: a real tablist owes the
 * user arrow-key navigation, and there is nothing here worth that contract —
 * these swap the form in place, they don't reveal a panel.
 */
function ModeTab({
  active,
  divider,
  onClick,
  children,
}: {
  active: boolean;
  /** Hairline between the two halves. Owned by the right one so the outer box keeps one border. */
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

/**
 * Log in / sign up / forgot password, in a dialog over the landing page.
 *
 * Login and signup both set the session cookie and return { user }, so the only
 * real differences between those two are the copy and the name field — the same
 * shape the old /login and /signup routes shared, now without the page load.
 *
 * Forgot is the odd one out: it navigates nowhere. /api/auth/forgot-password
 * answers the same 200 for an unknown address as for a real one, so there is
 * nothing to route on and the form is replaced in place by a confirmation that
 * is careful to claim no more than the API does.
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

  // Depends on `sent` as well as `mode`, and both directions matter. Dismissing
  // the confirmation ("try another address") unmounts the button focus is on
  // while `mode` stays "forgot" — so keyed on `mode` alone this never re-ran and
  // focus fell to <body>. The guard is what keeps it from fighting the effect
  // below when `sent` flips the other way.
  useEffect(() => {
    if (!sent) firstFieldRef.current?.focus();
  }, [mode, sent]);

  // The confirmation unmounts the submit button that focus is sitting on, and
  // focus then falls to <body> — outside the dialog, where the Tab-trap below
  // has nothing to cycle and the next Tab walks into the landing page.
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

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
    // The confirmation belongs to the request that was just made. Coming back
    // to this form later has to show a form, not a stale receipt.
    setSent(false);
    onSwitch(to);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // `noValidate` on the form, so these are the whole client-side check —
    // the server is still the one that decides.
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
        // Not left busy like the other two: nothing navigates away, the
        // confirmation takes the form's place instead.
        setSent(true);
        setBusy(false);
        return;
      }
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
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
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

        {/* Only where there is a choice to make. `forgot` is a detour off login,
            not a third account state, and the confirmation has finished with
            the question entirely — a switch on either would offer to change
            something the screen has already moved past. */}
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

        {/* The key replays the entrance whenever the subject changes, so a swap
            reads as a change of subject rather than a text diff. Handing off to
            the confirmation is as much of a change as switching mode is, hence
            `sent` in the key and not just `mode`. */}
        <div className="modal-head" key={mode + String(sent)}>
          {/* Flat ember on the accent word, not `.flame`. That class paints the
              word with a gradient and clips it to the glyphs; the reference has
              exactly one gradient in the whole product (the resume bar's wash)
              and it isn't type. */}
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

        {/* Deliberately worded to claim no more than the endpoint does: it
            answers the same 200 for an unknown address as for a real one, and
            copy that said "we've sent you an email" would hand back the
            account-enumeration answer the whole route was built to withhold. */}
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
                    /* Next to the Password label because that is the only
                       place anyone looks for it. Still not `.link-ember`, which
                       resets `font` to inherit and would blow this 10.5px mono
                       row up to body size — but no longer inline either. The
                       ember, the underline and its offset moved into
                       `.hint-link`: an inline style sits at the top of the
                       cascade, so this was the one accent in the dialog that no
                       scoped theme rule could ever have reached. */
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

            {/* `key={error}` so a repeated failure shakes again instead of
                sitting there looking like nothing happened. */}
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

        {/* Nothing here once the confirmation is up: it carries its own way
            back, and a second route out beside it just splits the decision. */}
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
