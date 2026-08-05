"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";

/**
 * The code /api/auth/reset-password uses for every way a token can fail —
 * unknown, expired, already spent. It is one code on purpose (telling those
 * apart would confirm to a link thief that the token was real), which is why
 * this screen can treat it as one terminal state.
 */
const DEAD_TOKEN = "invalid_reset_token";

/**
 * New password + confirmation, posting the token from the URL.
 *
 * The route signs them in on success, so there is no second trip through the
 * login form — whoever holds the token could set the password and log in with
 * it anyway, so the redirect to /dashboard gives away nothing extra.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dead, setDead] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const pwPct = Math.min((password.length / 12) * 100, 100);
  const pwOk = password.length >= 8;

  // Nothing else on the page is interactive, so the field is where a keyboard
  // should already be — the alternative is a Tab hunt on arrival.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // `noValidate` on the form, so these two are the whole client-side check.
    // The mismatch one is the reason the confirm field exists at all: this is
    // the one password nobody can recover by remembering it.
    if (!pwOk) {
      setError("Password needs at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two don’t match.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await apiPost<{ user: User }>("/api/auth/reset-password", { token, password });
      // Left busy on purpose: the navigation is the next thing that happens,
      // and the token is spent — a second submit can only fail.
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      // The server's wording is deliberate — it says "invalid or has expired"
      // for every failure mode rather than which — so surface it as written.
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
      // A rejected token is terminal. No amount of retyping fixes it, and a
      // form left sitting there invites exactly that, so trade it for the one
      // action that does help.
      if (err instanceof ApiClientError && err.code === DEAD_TOKEN) setDead(true);
      setBusy(false);
    }
  }

  if (dead) {
    return (
      <div className="mform">
        <p className="error-note" role="alert">
          <span aria-hidden="true">!</span> {error}
        </p>
        <Link href="/?auth=forgot" className="btn btn-primary btn-lg btn-block">
          Request a new link
        </Link>
        <p className="modal-sub">
          Links expire, and each one only works once — an older one in the same inbox will have been
          killed by a newer request.
        </p>
      </div>
    );
  }

  return (
    <form className="mform" onSubmit={onSubmit} noValidate>
      <div>
        <div className="field-row">
          <label className="label" htmlFor="r-password">
            New password
          </label>
          <span className={"hint" + (pwOk ? " ok" : "")}>
            {pwOk ? "that’ll do" : "at least 8 characters"}
          </span>
        </div>
        <div className="input-wrap">
          <input
            id="r-password"
            name="password"
            className="input has-toggle"
            required
            type={showPw ? "text" : "password"}
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            ref={firstFieldRef}
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
        <div className="pw-meter" aria-hidden="true">
          <div className={"pw-meter-fill" + (pwOk ? " ok" : "")} style={{ width: pwPct + "%" }} />
        </div>
      </div>

      <div>
        <div className="field-row">
          <label className="label" htmlFor="r-confirm">
            Again
          </label>
          {/* Only once there is something to compare against: "doesn't match"
              on an empty field is a complaint about typing speed. */}
          {confirm.length > 0 && (
            <span className={"hint" + (confirm === password ? " ok" : "")}>
              {confirm === password ? "matches" : "doesn’t match yet"}
            </span>
          )}
        </div>
        <input
          id="r-confirm"
          name="confirm"
          className="input"
          required
          // Follows the toggle above rather than carrying its own: two eyes on
          // one pair of fields is a switch that half-works.
          type={showPw ? "text" : "password"}
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError("");
          }}
        />
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
        {busy ? "One moment…" : "Save and sign in"}
      </button>

      {/* Kept in view even while the form still looks usable: a token that
          expired while this page sat open fails at submit, and the way out
          should already be on screen when it does. */}
      <p className="modal-sub">
        Link not working?{" "}
        <Link href="/?auth=forgot" className="link-ember">
          Ask for a fresh one
        </Link>
        .
      </p>
    </form>
  );
}
