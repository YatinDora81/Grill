"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";

const DEAD_TOKEN = "invalid_reset_token";

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

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Try again.");
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

      {error && (
        <p className="error-note" role="alert" key={error}>
          <span aria-hidden="true">!</span> {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? "One moment…" : "Save and sign in"}
      </button>

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
