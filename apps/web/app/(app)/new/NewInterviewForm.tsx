"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Difficulty, InterviewMode, InterviewType, StartResponse } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { Button, Card, ErrorNote, Eyebrow, Field, Input, Spinner, Textarea, cx } from "@/components/ui";

const MODES: {
  value: InterviewMode;
  label: string;
  blurb: string;
}[] = [
  {
    value: "resume",
    label: "Résumé only",
    blurb: "Questions dig into your own history — what you built, and what you'd rather skip.",
  },
  {
    value: "topic",
    label: "Topic",
    blurb: "Drills a subject, but ties it back to work you've actually done.",
  },
  {
    value: "topic_only",
    label: "Topic only",
    blurb: "Pure subject examination. Your résumé is ignored entirely.",
  },
  {
    value: "jd",
    label: "Job description",
    blurb: "Interviews you for a real posting, and probes the gaps against your résumé.",
  },
  {
    value: "real",
    label: "Real interview",
    blurb: "The full arc: basics, then technical depth, then the cultural questions with no clean answer.",
  },
  {
    value: "weak_spots",
    label: "Weak spots",
    blurb: "Re-asks the questions you scored worst on in past interviews, plus new ground.",
  },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
];

const TYPES: { value: InterviewType; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "technical", label: "Technical" },
  { value: "cultural", label: "Cultural" },
];

export function NewInterviewForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [resumeText, setResumeText] = useState("");
  const [mode, setMode] = useState<InterviewMode>("resume");
  const [topic, setTopic] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [role, setRole] = useState("");
  const [numQuestions, setNumQuestions] = useState(8);
  const [difficulty, setDifficulty] = useState<Difficulty>("mid");
  const [interviewType, setInterviewType] = useState<InterviewType>("mixed");
  // Off by default: this is a practice tool, so running the same résumé twice
  // must not produce the same interview twice.
  const [allowRepeats, setAllowRepeats] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState("");

  const active = MODES.find((m) => m.value === mode)!;
  const needsTopic = mode === "topic" || mode === "topic_only";
  const needsJd = mode === "jd";
  const hasResume = resumeText.trim().length > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setError("");
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("resume", file);
      // The API extracts text server-side; /start only ever takes text.
      const { text } = await apiPostForm<{ text: string; chars: number }>(
        "/api/interview/resume/extract",
        form,
      );
      setResumeText(text);
    } catch (err) {
      setFileName("");
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Couldn't read that file. Paste the text instead.",
      );
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasResume) {
      setError("Upload your résumé first — every interview is built around it.");
      return;
    }
    if (needsTopic && !topic.trim()) {
      setError("Name the topic you want drilled on.");
      return;
    }
    if (needsJd && !jobDescription.trim()) {
      setError("Paste the job description you're going for.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiPost<StartResponse>("/api/interview/start", {
        source_text: resumeText.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
        config: {
          num_questions: numQuestions,
          difficulty,
          interview_type: interviewType,
          mode,
          allow_repeats: allowRepeats,
          ...(needsTopic ? { topic: topic.trim() } : {}),
          ...(needsJd ? { job_description: jobDescription.trim() } : {}),
        },
      });
      router.push(`/session/${res.session_id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the interview.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-6">
      {/* Step 1 — the résumé. Required, and first: it's the candidate. */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Step 1 · Your résumé</Eyebrow>
          {hasResume ? (
            <span className="font-mono text-[11px] text-strong">✓ loaded</span>
          ) : (
            <span className="font-mono text-[11px] text-ember">required</span>
          )}
        </div>

        <div className="mt-4">
          <input
            ref={fileRef}
            id="resume"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            onChange={onFile}
            className="sr-only"
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
            >
              {extracting ? <Spinner /> : null}
              {extracting ? "Reading…" : "Upload PDF / DOCX"}
            </Button>
            {fileName && !extracting ? (
              <span className="truncate text-xs text-ink-muted">{fileName}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <Textarea
            id="resume_text"
            aria-label="Résumé text"
            rows={8}
            maxLength={20_000}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Upload a file above, or paste your résumé text here…"
          />
          <p className="tabular mt-1.5 text-right text-xs text-ink-muted">
            {resumeText.length.toLocaleString()} / 20,000
          </p>
        </div>
      </Card>

      {/* Step 2 — what to do with it. */}
      <Card className="p-5">
        <Eyebrow>Step 2 · What kind of interview</Eyebrow>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cx(
                "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                mode === m.value
                  ? "border-ember bg-ember-soft font-medium text-ink"
                  : "border-line text-ink-soft hover:bg-paper-sunken",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted">{active.blurb}</p>

        {needsTopic && (
          <div className="mt-4">
            <Field label="Topic" htmlFor="topic" hint="What should it drill you on?">
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={2_000}
                placeholder="Distributed systems: consistency, partitioning, failure modes…"
              />
            </Field>
          </div>
        )}

        {needsJd && (
          <div className="mt-4">
            <Field label="Job description" htmlFor="jd" hint="Paste the posting you're actually going for.">
              <Textarea
                id="jd"
                rows={6}
                maxLength={20_000}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Senior Backend Engineer — you'll own our billing pipeline, work in Go and Postgres…"
              />
            </Field>
          </div>
        )}
      </Card>

      {/* Step 3 — shape. */}
      <Card className="space-y-5 p-5">
        <Eyebrow>Step 3 · Shape</Eyebrow>

        <Field label="Role" htmlFor="role" hint="Optional — helps aim the questions.">
          <Input
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={200}
            placeholder="Senior Backend Engineer"
          />
        </Field>

        <Choice label="Level" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
        <Choice label="Focus" options={TYPES} value={interviewType} onChange={setInterviewType} />

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="num" className="block text-sm font-medium">
              Questions
            </label>
            <span className="tabular font-mono text-sm text-ink-soft">{numQuestions}</span>
          </div>
          <input
            id="num"
            type="range"
            min={1}
            max={20}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
            className="w-full accent-ember"
          />
          <p className="mt-1 text-xs text-ink-muted">
            Roughly {Math.max(2, Math.round(numQuestions * 1.8))} minutes.
          </p>
        </div>

        <Toggle
          label="Repeat past questions"
          hint={
            allowRepeats
              ? "Questions you've already been asked can come up again."
              : "Questions from your past interviews won't be reused."
          }
          checked={allowRepeats}
          onChange={setAllowRepeats}
        />
      </Card>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={busy || extracting || !hasResume}>
          {busy ? <Spinner /> : null}
          {busy ? "Writing your first question…" : "Start interview"}
        </Button>
        <p className="text-xs text-ink-muted">You can stop any time.</p>
      </div>
    </form>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="block text-sm font-medium">{label}</span>
        <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-ember" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-1 size-4 rounded-full bg-paper-raised transition-[left]",
            checked ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              value === o.value
                ? "border-ember bg-ember-soft font-medium text-ember"
                : "border-line-strong text-ink-soft hover:bg-paper-sunken",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
