"use client";

import { useState } from "react";
import type { CodeSubmission, RunResult } from "@repo/types";
import { Explain } from "@/components/Explain";

export interface CodeReplayTurn {
  turn_index: number;
  title: string;
  submission: CodeSubmission;
}

const LANGUAGE_LABEL: Record<CodeSubmission["language"], string> = {
  python: "Python",
  javascript: "JavaScript",
};

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function CodeReplay({ turns }: { turns: CodeReplayTurn[] }) {
  if (!turns.length) return null;

  return (
    <section style={{ marginTop: 28 }}>
      <p className="kicker">The code you wrote</p>
      <div style={{ marginTop: 8 }}>
        {turns.map((t) => (
          <Problem key={t.turn_index} turn={t} />
        ))}
      </div>
      <Explain>
        Every number here was <b>measured on your machine</b> while you worked: the tests ran in
        this browser, the timings came from the editor, and the think-aloud share is the part of the
        problem you spent talking, taken from the word timings of the recording. None of it is the
        coach&rsquo;s opinion.
      </Explain>
    </section>
  );
}

function Problem({ turn }: { turn: CodeReplayTurn }) {
  const [open, setOpen] = useState(false);
  const s = turn.submission;
  const n = turn.turn_index + 1;

  return (
    <div className="turn" data-open={open}>
      <button
        type="button"
        className="turn-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="turn-n" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <span className="turn-q">{turn.title}</span>
        <span className="turn-type">{LANGUAGE_LABEL[s.language]}</span>
        <span className="turn-type followup">
          {s.passed}/{s.total} passed
        </span>
        <span
          className={
            "grid size-6 flex-none place-items-center border text-[0.8rem] leading-none transition-colors " +
            (open ? "border-ember/40 text-ember" : "border-line text-ink-muted")
          }
          aria-hidden="true"
        >
          {open ? "–" : "+"}
        </span>
      </button>

      {open && (
        <div className="turn-body">
          <Facts submission={s} />
          <Results results={s.results} />
          <div>
            <p className="tr-label">Your submission</p>
            <pre className="code-src">{s.source || "(nothing submitted)"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Facts({ submission: s }: { submission: CodeSubmission }) {
  const k = s.keystrokes;
  const facts: [string, string][] = [
    ["first edit", k.first_edit_ms === null ? "never typed" : seconds(k.first_edit_ms)],
    ["longest idle", seconds(k.longest_idle_ms)],
    ["runs", String(k.runs)],
    ["time on the problem", seconds(k.submitted_at_ms)],
    ["think-aloud", s.think_aloud_pct === null ? "not measured" : `${s.think_aloud_pct}%`],
    ["longest silence", s.longest_silence_s === null ? "not measured" : `${s.longest_silence_s}s`],
  ];

  return (
    <div>
      <p className="tr-label" style={{ marginBottom: 8 }}>
        Measured while you coded
      </p>
      <div className="rubric">
        {facts.map(([label, value]) => (
          <div key={label}>
            <p className="rub-k">{label}</p>
            <p className="rub-v">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ results }: { results: RunResult[] }) {
  if (!results.length) {
    return <p className="mono-note">no tests were run before this was submitted</p>;
  }

  return (
    <div>
      <p className="tr-label" style={{ marginBottom: 8 }}>
        Tests
      </p>
      <div className="grid gap-1.5">
        {results.map((r) => (
          <div
            key={`${r.kind}-${r.index}`}
            className="border-l-2 py-1.5 pl-3"
            style={{
              borderColor: r.passed ? "var(--track-strong)" : "var(--edge-verdict-weak)",
            }}
          >
            <p className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-ink-muted">
              {r.kind} #{r.index + 1} ·{" "}
              <b className={r.passed ? "tone-strong" : "tone-weak"}>
                {r.timed_out ? "timed out" : r.passed ? "pass" : "fail"}
              </b>{" "}
              · {r.time_ms} ms
            </p>
            {r.passed ? null : (
              <div className="mt-1.5 grid gap-1">
                <p className="mono-note">expected</p>
                <pre className="code-src">{r.expected || "(nothing)"}</pre>
                <p className="mono-note">got</p>
                <pre className="code-src">{r.stdout || "(nothing)"}</pre>
                {r.stderr ? (
                  <>
                    <p className="mono-note">stderr</p>
                    <pre className="code-src">{r.stderr}</pre>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
