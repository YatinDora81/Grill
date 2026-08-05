"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { GrillToaster } from "@/components/toast";

async function apiPatch<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiClientError(
      body?.error?.message ?? "Something went wrong.",
      body?.error?.code ?? "unknown",
      res.status,
    );
  }
  return body as T;
}

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();

  const [name, setName] = useState(user.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState("");

  // A save button that's live when nothing changed promises work it can't do.
  const dirty = name.trim() !== (user.name ?? "");

  // Same meter as the signup modal — the two must never disagree about what a
  // good password looks like.
  const pwPct = Math.min((next.length / 12) * 100, 100);
  const pwOk = next.length >= 8;
  const confirmOk = confirm.length > 0 && next === confirm;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Give us something to call you.");
      return;
    }
    setSavingName(true);
    setNameError("");
    try {
      await apiPatch<User>("/api/profile", { name: name.trim() });
      toast.success("Saved");
      // The name is server-rendered in the plate, the greeting and the topbar
      // seal — refresh so all three update.
      router.refresh();
    } catch (err) {
      setNameError(err instanceof ApiClientError ? err.message : "Couldn't save that.");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    // Checked here as well as server-side: a typo in a field you can't read
    // should not cost a round trip to find out about.
    if (next !== confirm) {
      setPwError("The new passwords don't match.");
      return;
    }
    setSavingPw(true);
    setPwError("");
    try {
      await apiPost("/api/profile/password", {
        current_password: current,
        new_password: next,
      });
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowCurrent(false);
      setShowNext(false);
    } catch (err) {
      setPwError(err instanceof ApiClientError ? err.message : "Couldn't change it.");
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="profile-grid rv" data-io>
      <GrillToaster />

      {/* Plain `.card`, and a muted mono label instead of the ember `.kicker`.
          `.card-hairline` paints a 2px ember gradient across the top edge, and
          the redesign spends its one gradient on the resume bar; ember on a
          form heading would rank "Details" alongside the live-recording dot. */}
      <section className="card" aria-label="Your details">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-ink-muted">Details</p>
        <form onSubmit={saveName} className="mform">
          <div>
            <div className="field-row">
              <label className="label" htmlFor="name">
                Name
              </label>
              <span className="hint">what the dashboard calls you</span>
            </div>
            <input
              id="name"
              className="input"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                setNameError("");
              }}
              placeholder="Yatin"
            />
          </div>

          <div>
            <div className="field-row">
              <label className="label" htmlFor="email">
                Email
              </label>
              <span className="hint">sign-in address — fixed for now</span>
            </div>
            <input id="email" className="input" value={user.email} disabled readOnly />
          </div>

          {/* `key` so a repeated failure shakes again instead of sitting there
              looking like nothing happened. */}
          {nameError && (
            <p className="error-note" role="alert" key={nameError}>
              {nameError}
            </p>
          )}

          <div>
            <button type="submit" className="btn btn-primary" disabled={savingName || !dirty}>
              {savingName ? <span className="spinner" aria-hidden="true" /> : null}
              {savingName ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-label="Your password">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-ink-muted">Password</p>
        <form onSubmit={savePassword} className="mform">
          <div>
            <div className="field-row">
              <label className="label" htmlFor="current">
                Current password
              </label>
            </div>
            <div className="input-wrap">
              <input
                id="current"
                className="input has-toggle"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setPwError("");
                }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide current password" : "Show current password"}
              >
                {showCurrent ? "hide" : "show"}
              </button>
            </div>
          </div>

          <div>
            <div className="field-row">
              <label className="label" htmlFor="next">
                New password
              </label>
              <span className={"hint" + (pwOk ? " ok" : "")}>
                {pwOk ? "that’ll do" : "at least 8 characters"}
              </span>
            </div>
            <div className="input-wrap">
              <input
                id="next"
                className="input has-toggle"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setPwError("");
                }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Hide new password" : "Show new password"}
              >
                {showNext ? "hide" : "show"}
              </button>
            </div>
            <div className="pw-meter" aria-hidden="true">
              <div
                className={"pw-meter-fill" + (pwOk ? " ok" : "")}
                style={{ width: pwPct + "%" }}
              />
            </div>
          </div>

          <div>
            <div className="field-row">
              <label className="label" htmlFor="confirm">
                Confirm new password
              </label>
              {confirm.length > 0 && (
                <span className={"hint" + (confirmOk ? " ok" : "")}>
                  {confirmOk ? "they match" : "doesn’t match yet"}
                </span>
              )}
            </div>
            <input
              id="confirm"
              className="input"
              type={showNext ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setPwError("");
              }}
            />
          </div>

          {pwError && (
            <p className="error-note" role="alert" key={pwError}>
              {pwError}
            </p>
          )}

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingPw || !current || !next || !confirm}
            >
              {savingPw ? <span className="spinner" aria-hidden="true" /> : null}
              {savingPw ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
