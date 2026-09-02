"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { GrillToaster } from "@/components/toast";
import { Explain } from "@/components/Explain";
import { readLocalVoicePref, writeLocalVoicePref } from "@/hooks/useKokoro";

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

export function ProfileForm({
  user,
  emailOnReport,
  emailDigest,
}: {
  user: User;
  emailOnReport: boolean;
  emailDigest: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState(user.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const [mailOn, setMailOn] = useState(emailOnReport);
  const [savingMail, setSavingMail] = useState(false);

  const [digestOn, setDigestOn] = useState(emailDigest);
  const [savingDigest, setSavingDigest] = useState(false);

  const [localVoiceOn, setLocalVoiceOn] = useState(true);
  useEffect(() => setLocalVoiceOn(readLocalVoicePref()), []);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState("");

  const dirty = name.trim() !== (user.name ?? "");

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
      router.refresh();
    } catch (err) {
      setNameError(err instanceof ApiClientError ? err.message : "Couldn't save that.");
    } finally {
      setSavingName(false);
    }
  }

  async function toggleMail() {
    if (savingMail) return;
    const wanted = !mailOn;
    setMailOn(wanted);
    setSavingMail(true);
    try {
      await apiPatch<User>("/api/profile", { email_on_report: wanted });
      toast.success(wanted ? "We'll email you" : "Emails off");
    } catch (err) {
      setMailOn(!wanted);
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't save that.");
    } finally {
      setSavingMail(false);
    }
  }

  async function toggleDigest() {
    if (savingDigest) return;
    const wanted = !digestOn;
    setDigestOn(wanted);
    setSavingDigest(true);
    try {
      await apiPatch<User>("/api/profile", { email_digest: wanted });
      toast.success(wanted ? "We'll nudge you weekly" : "Digest off");
    } catch (err) {
      setDigestOn(!wanted);
      toast.error(err instanceof ApiClientError ? err.message : "Couldn't save that.");
    } finally {
      setSavingDigest(false);
    }
  }

  function toggleLocalVoice() {
    const wanted = !localVoiceOn;
    setLocalVoiceOn(wanted);
    writeLocalVoicePref(wanted);
    toast.success(wanted ? "This device will speak" : "On-device voice off");
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
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

        <div className="switch-row">
          <div>
            <span className="switch-l">Email me when a verdict is ready</span>
            <p className="switch-d">
              {mailOn
                ? "One email per report — the score, and the one thing to fix first."
                : "Reports still build; you'll just find them yourself."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mailOn}
            aria-label="Email me when a verdict is ready"
            aria-busy={savingMail}
            onClick={toggleMail}
            className="switch"
          />
        </div>
        <Explain>
          Sent once, when the report finishes building — <b>not</b> when the interview ends. The
          report is built by a queue behind you, so the email is what tells you it landed.
        </Explain>

        <div className="switch-row">
          <div>
            <span className="switch-l">Email me the weekly drill digest</span>
            <p className="switch-d">
              {digestOn
                ? "One email a week, and only when cards are due — it carries the question you're most overdue on."
                : "Cards still come due; the deck just waits at Drill until you open it."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={digestOn}
            aria-label="Email me the weekly drill digest"
            aria-busy={savingDigest}
            onClick={toggleDigest}
            className="switch"
          />
        </div>
        <Explain>
          At most one every seven days, and never for an empty deck — <b>nothing due, no email</b>.
          Turning it off stops the nudge; it does not stop your cards from coming back.
        </Explain>

        <div className="switch-row">
          <div>
            <span className="switch-l">
              Use the on-device interviewer voice (downloads ~90 MB once)
            </span>
            <p className="switch-d">
              {localVoiceOn
                ? "The model runs in this browser, so the room never waits on the voice server."
                : "Questions are read by the server voice, and by your browser's own when that runs out."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={localVoiceOn}
            aria-label="Use the on-device interviewer voice"
            onClick={toggleLocalVoice}
            className="switch"
          />
        </div>
        <Explain>
          English only, and kept in <b>this browser</b> rather than your account — the download is
          cached after the first interview, and other scripts still go to the server voice.
        </Explain>
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
