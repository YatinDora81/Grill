"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Difficulty,
  GenerateQuestionSetResponse,
  QuestionSetSource,
} from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import {
  coerceDifficulty,
  DIFFICULTIES,
  DIFFICULTY_META,
  QUESTION_SET_BOUNDS,
  SET_SOURCE_META,
} from "@/lib/interviewMeta";
import { Button, ErrorNote, Field, Input, Spinner, Textarea, cx } from "@/components/ui";
import { Explain } from "@/components/Explain";

const SOURCES: readonly QuestionSetSource[] = ["resume", "topic", "cultural"] as const;

const COUNT_PRESETS = [5, 8, 10, 15, 20];

const DIAL = "flex border border-line";
const DIALB =
  "flex-1 border-r border-line px-2 py-3 text-center font-mono text-[11px] tracking-[0.12em] uppercase transition-colors last:border-r-0";
const DIALB_ON = "bg-ink font-semibold text-paper";
const DIALB_OFF = "text-ink-soft hover:bg-(--surface-hover) hover:text-ink";

const PANEL = "border border-line bg-paper-raised px-6 py-6";

export function QuestionSetForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [source, setSource] = useState<QuestionSetSource>("resume");
  const [resumeText, setResumeText] = useState("");
  const [topic, setTopic] = useState("");
  const [role, setRole] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState(8);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const needsResume = source === "resume";
  const needsTopic = source === "topic";
  const hasMaterial = needsResume
    ? resumeText.trim().length > 0
    : needsTopic
      ? topic.trim().length > 0
      : true;

  const clampCount = (n: number) =>
    Math.min(QUESTION_SET_BOUNDS.max, Math.max(QUESTION_SET_BOUNDS.min, Math.round(n)));

  async function readFile(file: File) {
    setExtracting(true);
    setError("");
    setFileName(file.name);
    try {
      const form = new FormData();
      form.append("resume", file);
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
    if (submitting.current) return;

    if (!name.trim()) {
      setError("Give this set a name — it's how you'll find it again.");
      return;
    }
    if (needsResume && !resumeText.trim()) {
      setError("A résumé set needs a résumé — upload one or paste the text.");
      return;
    }
    if (needsTopic && !topic.trim()) {
      setError("Name the topic to generate questions on.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await apiPost<GenerateQuestionSetResponse>("/api/questions", {
        name: name.trim(),
        source,
        source_text: needsResume ? resumeText.trim() : needsTopic ? topic.trim() : "",
        ...(role.trim() ? { role: role.trim() } : {}),
        difficulty,
        count: clampCount(count),
      });
      router.push(`/questions/${res.set.id}`);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Couldn't generate the questions.",
      );
      submitting.current = false;
      setBusy(false);
    }
  }

  const heat = DIFFICULTY_META[coerceDifficulty(difficulty)];
  const working = busy || extracting;

  return (
    <form onSubmit={onSubmit} className="mt-9 grid max-w-[720px] gap-5" noValidate>
      <section className={PANEL}>
        <p className="mb-4 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase">
          What to draw from
        </p>
        <div className={DIAL} role="radiogroup" aria-label="Question source">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              onClick={() => {
                setSource(s);
                setError("");
              }}
              className={cx(DIALB, source === s ? DIALB_ON : DIALB_OFF)}
            >
              {SET_SOURCE_META[s].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-muted">
          {SET_SOURCE_META[source].blurb}
        </p>

        {needsResume ? (
          <div className="mt-5 grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
                className="sr-only"
                id="qset-resume-file"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={extracting}
                onClick={() => fileRef.current?.click()}
              >
                {extracting ? (
                  <>
                    <Spinner className="size-3.5" /> Reading…
                  </>
                ) : fileName ? (
                  "Replace file"
                ) : (
                  "Upload résumé"
                )}
              </Button>
              {fileName ? (
                <span className="font-mono text-[11px] text-ink-muted">{fileName}</span>
              ) : (
                <span className="font-mono text-[11px] text-ink-muted">
                  PDF, DOCX or TXT — or paste below
                </span>
              )}
            </div>
            <Field
              label="Résumé text"
              htmlFor="qset-resume"
              hint={resumeText ? `${resumeText.length.toLocaleString()} chars` : undefined}
            >
              <Textarea
                id="qset-resume"
                rows={7}
                maxLength={20_000}
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="The extractor fills this in — fix anything it mangled, or paste your résumé directly."
              />
            </Field>
          </div>
        ) : null}

        {needsTopic ? (
          <div className="mt-5">
            <Field label="Topic" htmlFor="qset-topic" hint="a subject line, not a document">
              <Input
                id="qset-topic"
                value={topic}
                maxLength={2_000}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. PostgreSQL indexing · React server components · Kafka consumer groups"
              />
            </Field>
          </div>
        ) : null}

        {source === "cultural" ? (
          <p className="mt-5 border border-line bg-paper-sunken px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-muted">
            No material needed — cultural sets ask about working style, conflict, feedback and
            values, never your projects.
          </p>
        ) : null}
      </section>

      <section className={PANEL}>
        <p className="mb-4 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase">
          How hard, how many
        </p>

        <div className={DIAL} role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={cx(DIALB, difficulty === d ? DIALB_ON : DIALB_OFF)}
            >
              {DIFFICULTY_META[d].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[0.85rem] leading-relaxed" style={{ color: heat.color }}>
          {heat.blurb}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_120px] sm:items-end">
          <div>
            <p className="mb-1.5 font-mono text-[11px] tracking-[0.16em] uppercase text-ink-soft">
              How many questions
            </p>
            <div className={DIAL} role="radiogroup" aria-label="Question count presets">
              {COUNT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={count === n}
                  onClick={() => setCount(n)}
                  className={cx(DIALB, count === n ? DIALB_ON : DIALB_OFF)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Exact"
            htmlFor="qset-count"
            hint={`${QUESTION_SET_BOUNDS.min}–${QUESTION_SET_BOUNDS.max}`}
          >
            <Input
              id="qset-count"
              type="number"
              inputMode="numeric"
              min={QUESTION_SET_BOUNDS.min}
              max={QUESTION_SET_BOUNDS.max}
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setCount(n);
              }}
              onBlur={() => setCount(clampCount(count))}
            />
          </Field>
        </div>
      </section>

      <section className={PANEL}>
        <p className="mb-4 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase">
          Name it and generate
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Set name" htmlFor="qset-name" hint="required">
            <Input
              id="qset-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backend screen prep · System design drills"
            />
          </Field>
          <Field label="Target role" htmlFor="qset-role" hint="optional">
            <Input
              id="qset-role"
              value={role}
              maxLength={200}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior backend engineer"
            />
          </Field>
        </div>

        <Explain>
          Nothing starts when you press this. The set lands on its own page as a{" "}
          <b>numbered list you read</b> — and that page keeps a &ldquo;run as interview&rdquo;
          button for whenever you want to face these questions live. Interviews run from a set
          ask <b>exactly these questions, in this order</b>.
        </Explain>

        {error ? (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button type="submit" size="lg" disabled={working || !hasMaterial || !name.trim()}>
            {busy ? (
              <>
                <Spinner /> Writing {clampCount(count)} questions…
              </>
            ) : (
              `Generate ${clampCount(count)} question${clampCount(count) === 1 ? "" : "s"}`
            )}
          </Button>
          {busy ? (
            <span className="font-mono text-[11px] text-ink-muted">
              Bigger sets take up to a minute.
            </span>
          ) : null}
        </div>
      </section>
    </form>
  );
}
