"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExclusiveMode, InterviewSource, StartResponse } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import {
  MODE_META,
  QUESTION_BOUNDS,
  SENIORITY_LADDER,
  SOURCE_META,
  YEAR_BOUNDS,
  perAnswerCapSeconds,
  seniorityFor,
} from "@/lib/interviewMeta";

import {
  Button,
  Card,
  ErrorNote,
  Eyebrow,
  Field,
  Input,
  Spinner,
  Textarea,
  cx,
} from "@/components/ui";

const SOURCES: InterviewSource[] = ["resume", "topic", "cultural"];
const MODES: ExclusiveMode[] = ["jd", "real", "topic_only", "weak_spots"];

/** Roughly how long an interview of N questions runs. */
function estimateMinutes(n: number): number {
  return Math.max(2, Math.round(n * 1.8));
}

/** Seconds → "4:00". The cap is always a whole 0:30, so no rounding to do. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function NewInterviewForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [resumeText, setResumeText] = useState("");
  // An interview is either blended from sources or one exclusive mode. Both
  // states live here because picking one has to clear the other — see `pickMode`.
  const [sources, setSources] = useState<InterviewSource[]>(["resume"]);
  const [mode, setMode] = useState<ExclusiveMode | null>(null);
  const [topic, setTopic] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [role, setRole] = useState("");
  const [numQuestions, setNumQuestions] = useState(8);
  // What the server will derive for this count. Cheap enough to just recompute.
  const answerCap = perAnswerCapSeconds(numQuestions);
  const [years, setYears] = useState(6);
  // Off by default: this is a practice tool, so running the same résumé twice
  // must not produce the same interview twice.
  const [allowRepeats, setAllowRepeats] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const hasResume = resumeText.trim().length > 0;
  const needsTopic = mode === "topic_only" || sources.includes("topic");
  const needsJd = mode === "jd";

  /** Ticking a source drops the exclusive mode — they can't coexist. */
  function toggleSource(s: InterviewSource) {
    setMode(null);
    setSources((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].sort(sourceOrder),
    );
  }

  /** Picking an exclusive mode clears the sources, and vice versa. */
  function pickMode(m: ExclusiveMode) {
    if (mode === m) {
      // Clicking the active mode again releases it — otherwise the only way
      // back to a blended interview is to reload the page.
      setMode(null);
      setSources(["resume"]);
      return;
    }
    setMode(m);
    setSources([]);
  }

  async function readFile(file: File) {
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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await readFile(file);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await readFile(file);
  }

  function clearResume() {
    setResumeText("");
    setFileName("");
    setError("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give this interview a name — it's how you'll find it later.");
    if (!hasResume) return setError("Upload your résumé first — every interview is built around it.");
    if (!mode && sources.length === 0) return setError("Pick what this interview should draw on.");
    if (needsTopic && !topic.trim()) return setError("Name the topic you want drilled on.");
    if (needsJd && !jobDescription.trim()) return setError("Paste the job description you're going for.");

    setBusy(true);
    setError("");
    try {
      const res = await apiPost<StartResponse>("/api/interview/start", {
        source_text: resumeText.trim(),
        name: name.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
        config: {
          num_questions: numQuestions,
          years_experience: years,
          sources,
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
    <form onSubmit={onSubmit} className="mt-6 space-y-5 sm:mt-8 sm:space-y-6">
      {/* The name leads, borderless and large: it's the title of the thing being
          made, not another field in a stack of fields. */}
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Name this interview…"
          aria-label="Interview name"
          className="font-display w-full bg-transparent text-2xl tracking-tight text-ink placeholder:text-ink-muted/60 focus:outline-none sm:text-3xl"
        />
        <div className="mt-2 h-px bg-line" />
      </div>

      {/* Step 1 — the résumé. Required, and first: it's the candidate. */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Step 1 · Your résumé</Eyebrow>
          {hasResume ? (
            <span className="font-mono text-[11px] text-strong">✓ loaded</span>
          ) : (
            <Eyebrow tone="ember">required</Eyebrow>
          )}
        </div>

        <input
          ref={fileRef}
          id="resume"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,text/plain"
          onChange={onFile}
          className="sr-only"
        />

        {!hasResume ? (
          // The drop zone only exists until there's a résumé — once the text is
          // in, the text IS the control, and a target to drop onto is clutter.
          // A <label>, not a <div>: touch devices never fire HTML5 drag events,
          // so on a phone the only way in was the ~44x20px "browse" link — and
          // a résumé is required to start an interview. Pointing the label at
          // the sr-only file input makes the whole zone open the picker
          // natively, with no click handler to double-fire against the input
          // and no loss of keyboard access.
          <label
            htmlFor="resume"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              "mt-4 block cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-14",
              dragging ? "border-ember bg-ember-soft" : "border-line-strong bg-paper-sunken",
            )}
          >
            {extracting ? (
              <>
                <Spinner className="text-ember" />
                <p className="mt-3 text-sm text-ink-soft">Reading {fileName}…</p>
              </>
            ) : (
              <>
                <DocIcon />
                {/* A span, not a button: the whole label is the control now,
                    and a nested button would both double-fire the picker and be
                    invalid inside a <label>. */}
                <p className="mt-3 text-sm font-medium text-ink">
                  Drop your résumé here, or{" "}
                  <span className="text-ember underline underline-offset-4">browse</span>
                </p>
                <p className="mt-1.5 text-xs text-ink-muted">PDF, DOCX or TXT — up to 20,000 characters</p>
              </>
            )}
          </label>
        ) : (
          <div className="mt-4">
            {/* What we actually parsed. Shown, not hidden behind a filename: the
                extractor is the most likely thing to have quietly mangled a
                two-column PDF, and only the candidate can tell. */}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-ink">
                <span className="text-ink-muted">Parsed from</span>{" "}
                {fileName || "pasted text"}
              </p>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearResume}
                  className="text-xs text-ink-muted underline underline-offset-4 hover:text-weak"
                >
                  Clear
                </button>
              </div>
            </div>
            <Textarea
              id="resume_text"
              aria-label="Résumé text"
              rows={10}
              maxLength={20_000}
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              // `sm:text-xs` only: below sm this inherits CONTROL's 16px, which
              // is what stops iOS zooming into the one field we ask people to
              // proofread. A bare `text-xs` would apply at every width.
              className="mt-2.5 font-mono leading-relaxed sm:text-xs"
            />
            <p className="tabular mt-1.5 text-right text-xs text-ink-muted">
              {resumeText.length.toLocaleString()} / 20,000 · edit anything the parser got wrong
            </p>
          </div>
        )}
      </Card>

      {/* Step 2 — what to do with it. */}
      <Card className="p-4 sm:p-5">
        <Eyebrow>Step 2 · What kind of interview</Eyebrow>

        <p className="mt-3 text-xs text-ink-muted">Mix as many as you want — it stays one conversation.</p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {SOURCES.map((s) => (
            <Pick
              key={s}
              selected={sources.includes(s)}
              onClick={() => toggleSource(s)}
              label={SOURCE_META[s].label}
              blurb={SOURCE_META[s].blurb}
              kind="checkbox"
            />
          ))}
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="font-mono text-[11px] tracking-[0.16em] text-ink-muted uppercase">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <p className="text-xs text-ink-muted">
          These bring their own shape, so they run on their own.
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <Pick
              key={m}
              selected={mode === m}
              onClick={() => pickMode(m)}
              label={MODE_META[m].label}
              blurb={MODE_META[m].blurb}
              kind="radio"
            />
          ))}
        </div>

        {needsTopic && (
          <div className="mt-5">
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
          <div className="mt-5">
            <Field
              label="Job description"
              htmlFor="jd"
              hint="Paste the posting you're actually going for."
            >
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

        {/* Repeats live here, not in "shape": whether old questions can come
            back is part of what kind of interview this is. */}
        <div className="mt-5 border-t border-line pt-5">
          <Toggle
            label="Repeat past questions"
            hint={
              allowRepeats
                ? "Questions you've already been asked can come up again."
                : "Every question you've been asked before is off the table."
            }
            checked={allowRepeats}
            onChange={setAllowRepeats}
          />
        </div>
      </Card>

      {/* Step 3 — shape. */}
      <Card className="space-y-5 p-4 sm:p-5">
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

        <Level years={years} onChange={setYears} />

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label htmlFor="num" className="block text-sm font-medium">
              Questions
            </label>
            <span className="tabular font-mono text-sm text-ink-soft">
              {numQuestions}
              <span className="ml-2 text-ink-muted">≈ {estimateMinutes(numQuestions)} min</span>
            </span>
          </div>
          <input
            id="num"
            type="range"
            min={QUESTION_BOUNDS.min}
            max={QUESTION_BOUNDS.max}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
            className="w-full accent-ember"
          />
          <div className="tabular mt-1 flex justify-between font-mono text-[11px] text-ink-muted">
            <span>{QUESTION_BOUNDS.min}</span>
            <span>{QUESTION_BOUNDS.max}</span>
          </div>
          {/* Display only — the start route derives and stores the real cap.
              More questions means less time for each: say so here rather than
              let it be discovered by the recorder cutting someone off. */}
          {answerCap !== null && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Up to <span className="tabular font-mono">{clock(answerCap)}</span> per answer
            </p>
          )}
        </div>
      </Card>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          size="lg"
          disabled={busy || extracting || !hasResume || !name.trim()}
          className="w-full sm:w-auto"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Writing your first question…" : "Start interview"}
        </Button>
        <p className="text-center text-xs text-ink-muted sm:text-left">You can stop any time.</p>
      </div>
    </form>
  );
}

/** Keeps the blend in a stable order however it was clicked together. */
function sourceOrder(a: InterviewSource, b: InterviewSource): number {
  return SOURCES.indexOf(a) - SOURCES.indexOf(b);
}

/**
 * One option in either picker.
 *
 * `kind` drives the ARIA role, not the look: a checkbox that behaves like a
 * radio is exactly the confusion this screen has to avoid, and a screen reader
 * has no other way to know which of the two groups it's in.
 */
function Pick({
  selected,
  onClick,
  label,
  blurb,
  kind,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  blurb: string;
  kind: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        "rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-ember bg-ember-soft"
          : "border-line text-ink-soft hover:border-line-strong hover:bg-paper-sunken",
      )}
    >
      <span className="flex items-center gap-2">
        <Mark selected={selected} round={kind === "radio"} />
        <span className={cx("text-sm", selected && "font-medium text-ink")}>{label}</span>
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">{blurb}</span>
    </button>
  );
}

function Mark({ selected, round }: { selected: boolean; round: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-4 shrink-0 items-center justify-center border transition-colors",
        round ? "rounded-full" : "rounded",
        selected ? "border-ember bg-ember" : "border-line-strong",
      )}
    >
      {selected ? <span className={cx("size-1.5 bg-paper", round ? "rounded-full" : "rounded-xs")} /> : null}
    </span>
  );
}

/** Where a given year sits along the track, 0–100. */
function yearPct(years: number): number {
  return ((years - YEAR_BOUNDS.min) / (YEAR_BOUNDS.max - YEAR_BOUNDS.min)) * 100;
}

/**
 * The track's colour bands, each ending halfway between its last year and the
 * next rung's first — the same rounding the thumb does, so the two agree.
 */
const RAMP_STOPS = SENIORITY_LADDER.flatMap((rung, i) => {
  const start = i === 0 ? 0 : yearPct(SENIORITY_LADDER[i - 1]!.maxYears + 0.5);
  const end = i === SENIORITY_LADDER.length - 1 ? 100 : yearPct(rung.maxYears + 0.5);
  return [`${rung.color} ${start}%`, `${rung.color} ${end}%`];
}).join(", ");

/**
 * Years of experience, 1–20.
 *
 * The rung label and its colour are the point: nobody knows what "level 14"
 * means, but everyone knows what Principal means, and the green→red ramp says
 * plainly that this is a dial for how hard you want it — not a boast.
 */
function Level({ years, onChange }: { years: number; onChange: (v: number) => void }) {
  const rung = seniorityFor(years);
  const pct = yearPct(years);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor="years" className="block text-sm font-medium">
          Level
        </label>
        <span className="flex items-baseline gap-2">
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide"
            style={{ backgroundColor: `${rung.color}1f`, color: rung.color }}
          >
            {rung.label}
          </span>
          <span className="tabular font-mono text-sm text-ink-soft">
            {years} {years === 1 ? "yr" : "yrs"}
          </span>
        </span>
      </div>

      <div className="relative">
        {/* The ramp is the track, in hard bands rather than a smooth blend: the
            thumb has to sit on the exact colour of the rung it selects, and the
            rungs aren't evenly spaced (they end at 2, 5, 9, 13, 17, 20 years).
            An evenly-spaced gradient puts an amber "Senior" thumb over lime
            track, which reads as a bug in the control. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ background: `linear-gradient(to right, ${RAMP_STOPS})` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full bg-paper-sunken"
          style={{ left: `${pct}%`, right: 0 }}
        />
        <input
          id="years"
          type="range"
          min={YEAR_BOUNDS.min}
          max={YEAR_BOUNDS.max}
          value={years}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${years} years — ${rung.label}`}
          // The thumb needs an explicit background: styling it without one
          // leaves the browser's default accent square showing through the ring.
          // It carries the rung's own colour, so it reads as a bead riding the
          // ramp rather than a control painted on top of one.
          className="relative w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-7px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-paper [&::-webkit-slider-thumb]:bg-[var(--thumb)] [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.5)] [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-paper [&::-moz-range-thumb]:bg-[var(--thumb)]"
          style={{ "--thumb": rung.color } as React.CSSProperties}
        />
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{rung.blurb}</p>
    </div>
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

function DocIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="mx-auto text-ink-muted"
    >
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
