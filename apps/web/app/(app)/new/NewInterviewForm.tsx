"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Difficulty, ExclusiveMode, InterviewSource, StartResponse } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import {
  DIFFICULTIES,
  DIFFICULTY_META,
  MODE_META,
  QUESTION_BOUNDS,
  SOURCE_META,
  perAnswerCapSeconds,
} from "@/lib/interviewMeta";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

const SOURCES: InterviewSource[] = ["resume", "topic", "cultural"];
const MODES: ExclusiveMode[] = [
  "jd",
  "project",
  "real",
  "topic_only",
  "cultural_only",
  "weak_spots",
];

/**
 * The right-hand tag on a mode row.
 *
 * The reference puts a mono tag at the end of every option row; rather than
 * invent marketing for it, it carries the one thing about a mode the picker
 * can't otherwise say — that choosing it makes a field back on step 1 required.
 * That's the same fact `checks` enforces, said before it bites instead of after.
 */
const MODE_NEEDS: Partial<Record<ExclusiveMode, string>> = {
  jd: "needs a posting",
  topic_only: "needs a topic",
  project: "needs a write-up",
};

type WizardStep = 1 | 2 | 3;

const STEPS: { n: WizardStep; label: string }[] = [
  { n: 1, label: "What to ask about" },
  { n: 2, label: "How hard" },
  { n: 3, label: "Name it and start" },
];

/**
 * Counts worth one click. The slider stays the authority — every integer in
 * QUESTION_BOUNDS is still reachable, and these are only the ones people ask
 * for often enough to deserve a shortcut.
 */
const QUESTION_PRESETS = [5, 8, 12, 20];

/** What /api/interview/project/extract returns for the imported repo. */
interface RepoInfo {
  owner: string;
  repo: string;
  language: string;
  stars: number;
  truncated: boolean;
}

/** One check out of the submit cascade, tagged with the step that owns its field. */
interface Check {
  step: WizardStep;
  failed: boolean;
  message: string;
  /**
   * True for a check whose requirement the NEXT step can lift.
   *
   * There is exactly one: the résumé is mandatory for every shape except a
   * project interview, and the shape is chosen on step 2. Treating it as an
   * ordinary step-1 blocker deadlocks the wizard — Next is disabled on step 1
   * until you upload a résumé, and the control that would make the résumé
   * unnecessary is on the step you can't reach. Someone who came to be
   * interviewed about a GitHub repo has no résumé to give and no way forward.
   *
   * So it's suppressed while the user is standing ON step 1, and enforced
   * everywhere after: as a `priorBlock` banner on steps 2 and 3, by the step-3
   * submit guard, and by the full unfiltered cascade in `onSubmit`.
   */
  deferUntilShape?: boolean;
}

/* Long strings the wizard chrome repeats across siblings. Hoisted rather than
   smeared inline, the way components/ui.tsx hoists BUTTON_BASE. */
const STEPBTN =
  "flex flex-1 items-center gap-2.5 border-r border-line px-3 py-3.5 text-left font-mono text-[10px] tracking-[0.14em] uppercase transition-colors last:border-r-0 sm:px-4";
const STEPBTN_ON = "bg-paper-raised text-ink";
const STEPBTN_OFF = "text-ink-muted hover:bg-paper-raised hover:text-ink-soft";
/* A number in a box, not a bullet. The only circles left in the product are the
   ones where a circle IS the thing — a status dot, a point on the trend line. */
const STEPNUM = "grid size-6 shrink-0 place-items-center border font-mono text-[10px] leading-none";
const STEPNUM_ON = "border-ember bg-ember font-semibold text-paper";
const STEPNUM_DONE = "border-strong/45 text-strong";
const STEPNUM_OFF = "border-line text-ink-muted";

/* The dial: one bordered row of segments, the chosen one filled. Shared by
   difficulty and the question-count presets so the two can't drift — they are
   the same gesture (pick one of a few) and the reference draws them identically. */
const DIAL = "flex border border-line";
const DIALB =
  "flex-1 border-r border-line px-2 py-3 text-center font-mono text-[11px] tracking-[0.12em] uppercase transition-colors last:border-r-0";
const DIALB_ON = "bg-ink font-semibold text-paper";
const DIALB_OFF = "text-ink-soft hover:bg-paper-raised hover:text-ink";

/* Options as a bordered stack, not a grid of cards: one column of rows reads as
   a list of mutually-comparable choices, which is what both pickers are. The
   selected row is marked by an inset edge rather than a border colour change, so
   nothing in the stack shifts by a pixel when the choice moves. */
const PICKS = "border border-line";
const PICK =
  "grid w-full grid-cols-[auto_1fr] items-start gap-x-4 border-b border-line px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-paper-raised sm:grid-cols-[auto_1fr_auto] sm:px-5";
const PICK_ON = "bg-paper-raised shadow-[inset_3px_0_0_var(--color-ember)]";
const PICK_BOX =
  "mt-0.5 grid size-[18px] shrink-0 place-items-center border text-[10px] leading-none";
const PICK_BOX_ON = "border-ember bg-ember text-paper";
const PICK_BOX_OFF = "border-line-strong";
const PICK_T = "font-mono text-[12px] tracking-[0.1em] uppercase";
const PICK_D = "text-[13px] leading-relaxed text-ink-soft";
const PICK_META =
  "font-mono text-[9.5px] tracking-[0.12em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden";

/*
 * The wizard's own buttons rather than `.btn`.
 *
 * The reference's primary action is a cream slab with a mono, wide-tracked label
 * that goes red on hover; `.btn-primary` is an ember fill with a sans label.
 * `.btn` is unlayered CSS and beats every Tailwind utility, so the only way to
 * state a different button here is not to be one.
 */
const WBTN =
  "inline-flex min-h-[52px] items-center justify-center gap-3 border px-6 font-mono text-[11.5px] font-semibold tracking-[0.14em] uppercase transition-colors disabled:cursor-wait disabled:opacity-55";
const WBTN_GO = "border-ink bg-ink text-paper hover:border-ember hover:bg-ember";
const WBTN_BACK = "border-line bg-transparent text-ink hover:border-ember hover:text-ember";
const WBTN_SM = "min-h-[38px] gap-2 px-4 text-[10px]";

const MONO_NOTE = "font-mono text-[10px] tracking-[0.18em] uppercase text-ink-muted";
const FACT_ROW =
  "flex items-baseline justify-between gap-4 px-5 py-2.5 font-mono text-[11px] tracking-[0.08em] uppercase";
/* Short measure on purpose: the headline is meant to break over two or three
   lines and sit as a block, which is what makes it read as display type rather
   than as a long label. */
const STEP_LEAD =
  "max-w-[16ch] font-display text-[1.7rem] leading-[1.02] font-extrabold tracking-[-0.02em] uppercase sm:text-[2.15rem]";
const STEP_SUB = "mt-3.5 max-w-[56ch] text-[14px] leading-relaxed text-ink-soft";

/** Roughly how long an interview of N questions runs. */
function estimateMinutes(n: number): number {
  return Math.max(2, Math.round(n * 1.8));
}

/** Seconds → "4:00". The cap is always a whole 0:30, so no rounding to do. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "An 8-question" but "A 4-question" — the article follows the sound of the
 * spoken numeral, so eight, eleven, eighteen and the eighties take "an".
 */
function article(n: number): "A" | "An" {
  const s = String(n);
  if (s === "11" || s === "18") return "An";
  return s.startsWith("8") ? "An" : "A";
}

export function NewInterviewForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>(1);
  /**
   * The heading of the step currently on screen, and whether the last render
   * was a step change. Swapping the panel is otherwise silent: the primary path
   * is the Next button, which stays focused while everything beneath it is
   * replaced, so a screen reader hears only the button's own name change. The
   * flag keeps first paint alone — stealing focus on mount would drag the page
   * past its own heading.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const [name, setName] = useState("");
  const [resumeText, setResumeText] = useState("");
  // An interview is either blended from sources or one exclusive mode. Both
  // states live here because picking one has to clear the other — see `pickMode`.
  const [sources, setSources] = useState<InterviewSource[]>(["resume"]);
  const [mode, setMode] = useState<ExclusiveMode | null>(null);
  const [topic, setTopic] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  // Project mode: the material the interview reads (pasted text or an edited
  // repo digest), the URL it was imported from, and the repo chip to show.
  const [projectContext, setProjectContext] = useState("");
  const [projectRepoUrl, setProjectRepoUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [projectTab, setProjectTab] = useState<"paste" | "import">("paste");
  const [importing, setImporting] = useState(false);
  const [role, setRole] = useState("");
  const [numQuestions, setNumQuestions] = useState(8);
  // What the server will derive for this count. Cheap enough to just recompute.
  const answerCap = perAnswerCapSeconds(numQuestions);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  // Off by default: this is a practice tool, so running the same résumé twice
  // must not produce the same interview twice.
  const [allowRepeats, setAllowRepeats] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * The real guard against a second /interview/start. `busy` drives the button's
   * disabled state, but that only ever blocked the *click* path — implicit form
   * submission (Enter in any field) fires onSubmit regardless, and /start holds
   * the request open for ~12s while the LLM writes the first question, which is
   * a wide window to submit into. A ref rather than `busy` because a state
   * update isn't visible to a second handler in the same tick, and because
   * /start is not idempotent: every call creates a session, and the one the
   * router doesn't navigate to is stranded `in_progress` forever.
   */
  const submitting = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const hasResume = resumeText.trim().length > 0;
  const needsTopic = mode === "topic_only" || sources.includes("topic");
  const needsJd = mode === "jd";
  const needsProject = mode === "project";
  const hasProject = projectContext.trim().length > 0;

  /**
   * The submit cascade, in its original order and wording, with each check
   * tagged by the step that owns the field it names.
   *
   * One list rather than a validator per step: splitting the form must not
   * split the conditions, or the wizard lets through a config the server's
   * superRefine then rejects — and the user sees a different sentence than the
   * one this screen would have said.
   */
  const checks: Check[] = [
    {
      step: 3,
      failed: !name.trim(),
      message: "Give this interview a name — it's how you'll find it later.",
    },
    {
      step: 1,
      // A project interview brings its own material, so the résumé is optional
      // there and only there — every other shape is built around it. The shape
      // is picked on step 2, which is why this one defers; see `Check`.
      deferUntilShape: true,
      failed: !hasResume && !needsProject,
      message: "Upload your résumé first — every interview is built around it.",
    },
    {
      step: 2,
      failed: !mode && sources.length === 0,
      message: "Pick what this interview should draw on.",
    },
    { step: 1, failed: needsTopic && !topic.trim(), message: "Name the topic you want drilled on." },
    {
      step: 1,
      failed: needsJd && !jobDescription.trim(),
      message: "Paste the job description you're going for.",
    },
    {
      step: 1,
      failed: needsProject && !hasProject,
      message: "Describe the project, or import a GitHub repo.",
    },
  ];

  // Split two ways on purpose. A blocker on THIS step is fixable where the user
  // is standing, so it disables Next and says so. A blocker left behind on an
  // earlier step usually appeared because the shape picked here made a field
  // back there newly required — disabling Next for that would strand someone in
  // front of a control that can't fix it, so it stays clickable and navigates.
  // `deferUntilShape` is only ever suppressed while standing on the step that
  // owns it — on step 2 and 3 it comes back as a `priorBlock`, which is the
  // clickable banner rather than a dead button, and the shape picker that can
  // clear it is right there.
  const deferred = (c: Check) => c.deferUntilShape === true && c.step === step;
  const ownBlock = checks.find((c) => c.failed && c.step === step && !deferred(c)) ?? null;
  const priorBlock = checks.find((c) => c.failed && c.step < step) ?? null;

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

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headingRef.current?.focus();
  }, [step]);

  /** Every step change goes through here, so none of them lands silently. */
  function moveToStep(n: WizardStep) {
    // Guarded: routing a blocker back to the step it's already on is a no-op
    // render, and the flag would otherwise sit armed until some later move.
    if (n !== step) moved.current = true;
    setStep(n);
  }

  function goToStep(n: WizardStep) {
    setError("");
    moveToStep(n);
  }

  /**
   * Forward one step, re-running every check the steps behind it own — choosing
   * a shape on step 2 can make a step-1 field newly required, and the field for
   * it lives back there. Landing on the failing step beats an error that names
   * a control the user can't see.
   */
  function goNext() {
    // Same suppression as `ownBlock`, and it has to be here too: without it Next
    // becomes clickable and then routes the user back to the step they're already
    // on, which renders as a dead button that only produces an error.
    const blocked = checks.find((c) => c.failed && c.step <= step && !deferred(c));
    if (blocked) {
      setError(blocked.message);
      moveToStep(blocked.step);
      return;
    }
    setError("");
    moveToStep(step === 1 ? 2 : 3);
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
      // Reset the input or re-picking the same file fires no change event and
      // the replace button silently does nothing.
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

  /**
   * Reads a GitHub repo once, server-side, into an editable digest — the same
   * "extract once, edit anything the parser got wrong" flow as the résumé. The
   * digest becomes the interview material; /start never touches GitHub.
   */
  async function importRepo() {
    if (!repoUrl.trim()) return setError("Paste a GitHub repo URL to import.");
    setImporting(true);
    setError("");
    try {
      const res = await apiPost<{ digest: string; repo: RepoInfo; chars: number }>(
        "/api/interview/project/extract",
        { repo_url: repoUrl.trim() },
      );
      setProjectContext(res.digest);
      setProjectRepoUrl(repoUrl.trim());
      setRepoInfo(res.repo);
      // Autofill the name from the repo if the user hasn't titled it — they can
      // still overwrite it. The name field now lives on step 3, which is exactly
      // why this still matters: it's the one they'd otherwise reach empty.
      if (!name.trim()) setName(res.repo.repo);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Couldn't read that repo. Paste a description instead.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    // Every step keeps a submit button, so implicit submission (Enter in any
    // field) lands here from all three. On the first two it means "next".
    if (step !== 3) return goNext();

    // The original cascade, unchanged — same order, same conditions, same
    // strings — routing to the step that owns whichever field failed.
    const blocked = checks.find((c) => c.failed);
    if (blocked) {
      setError(blocked.message);
      moveToStep(blocked.step);
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await apiPost<StartResponse>("/api/interview/start", {
        // Empty is legal for a project interview — it carries its own material.
        source_text: resumeText.trim(),
        name: name.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
        config: {
          num_questions: numQuestions,
          difficulty,
          sources,
          mode,
          allow_repeats: allowRepeats,
          ...(needsTopic ? { topic: topic.trim() } : {}),
          ...(needsJd ? { job_description: jobDescription.trim() } : {}),
          ...(needsProject
            ? {
                project_context: projectContext.trim(),
                ...(projectRepoUrl ? { project_repo_url: projectRepoUrl } : {}),
              }
            : {}),
        },
      });
      router.push(`/session/${res.session_id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't start the interview.");
      // Only reopened on failure. The success path navigates away, and leaving
      // it latched until then is what stops a submit landing during the push.
      submitting.current = false;
      setBusy(false);
    }
  }

  const heat = DIFFICULTY_META[difficulty];
  const rangePct =
    ((numQuestions - QUESTION_BOUNDS.min) / (QUESTION_BOUNDS.max - QUESTION_BOUNDS.min)) * 100;

  // What the interview draws on, in the words the picker used.
  const shapeLabel = mode
    ? MODE_META[mode].label
    : sources.map((s) => SOURCE_META[s].label).join(" + ");

  const working = busy || extracting || importing;
  const workingNote = busy
    ? "Starting…"
    : extracting
      ? "Reading your résumé…"
      : importing
        ? "Reading the repo…"
        : "";

  return (
    <form
      onSubmit={onSubmit}
      className="mt-9 grid items-start gap-8 border-t border-line pt-9 pb-4 lg:grid-cols-[minmax(0,1fr)_330px] xl:gap-10"
    >
      {/* `rv`/`data-io` only on the two columns: Reveal observes [data-io] once
          at mount, so anything that appears with a later step would stay at
          opacity 0 forever. */}
      <div className="rv min-w-0" data-io>
        {/* Steps, not tabs. It looks like a tab strip, but a wizard is linear and
            the APG tabs contract (roving tabindex, arrow-key navigation) is the
            wrong keyboard model for it — every step should stay tabbable. So:
            plain buttons carrying aria-current, and focus moves to the new
            step's heading on each transition. */}
        <div role="group" aria-label="Interview setup" className="flex border border-line">
          {STEPS.map(({ n, label }) => (
            <button
              key={n}
              type="button"
              aria-current={step === n ? "step" : undefined}
              onClick={() => goToStep(n)}
              className={cx(STEPBTN, step === n ? STEPBTN_ON : STEPBTN_OFF)}
            >
              <span
                aria-hidden="true"
                className={cx(
                  STEPNUM,
                  step === n ? STEPNUM_ON : step > n ? STEPNUM_DONE : STEPNUM_OFF,
                )}
              >
                {step > n ? "✓" : n}
              </span>
              <span className="truncate max-sm:sr-only">{label}</span>
              {/* The ✓ is decorative, so done-ness has to be said somewhere. */}
              {step > n && <span className="sr-only">— done</span>}
            </button>
          ))}
        </div>

        {/* ── 01 · what to ask about ──────────────────────────────────── */}
        {step === 1 && (
          <section aria-labelledby="wiz-head-1" className="mt-10">
            {/* Focus target for the transition — see `moved`. */}
            <h2 id="wiz-head-1" ref={headingRef} tabIndex={-1} className={STEP_LEAD}>
              What should it <span className="text-ember">read?</span>
            </h2>
            <p className={STEP_SUB}>
              Your résumé is the material every interview is built on — the interviewer reads it
              before you sit down. Whatever else the shape you pick needs shows up here too.
            </p>

            <div className="mt-8 flex items-center justify-between gap-4">
              <span className="label">Résumé</span>
              {hasResume ? (
                <span className="chip chip-ok">✓ loaded</span>
              ) : needsProject ? (
                // A project interview brings its own material — the résumé is
                // only ever background here, so it isn't required.
                <span className="chip">optional</span>
              ) : (
                // Names the one shape that doesn't need it, rather than leaving
                // that to be discovered on the next step. Step 1 is where someone
                // with no résumé decides whether this product is for them.
                <span className="chip chip-req">required — unless you pick Project</span>
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
              // so pointing the label at the sr-only file input makes the whole
              // zone open the picker natively, with no click handler to double-fire
              // against the input and no loss of keyboard access.
              <label
                htmlFor="resume"
                data-drag={dragging}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className="drop"
              >
                {extracting ? (
                  <>
                    <span className="mx-auto block size-6 animate-spin rounded-full border-2 border-ember/30 border-t-ember" aria-hidden="true" />
                    <p className="drop-t">Reading {fileName}…</p>
                  </>
                ) : (
                  <>
                    <DocIcon />
                    {/* A span, not a button: the whole label is the control now,
                        and a nested button would both double-fire the picker and be
                        invalid inside a <label>. */}
                    <p className="drop-t">
                      Drop your résumé here, or <i>browse</i>
                    </p>
                    <p className="drop-d">PDF, DOCX or TXT — up to 20,000 characters</p>
                  </>
                )}
              </label>
            ) : (
              <div className="mt-3">
                {/* What we actually parsed. Shown, not hidden behind a filename: the
                    extractor is the most likely thing to have quietly mangled a
                    two-column PDF, and only the candidate can tell. */}
                <div className="parsed-row">
                  <p className="parsed-from">
                    <span>Parsed from</span> {fileName || "pasted text"}
                  </p>
                  <div className="parsed-acts">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="underlink"
                    >
                      replace
                    </button>
                    <button type="button" onClick={clearResume} className="underlink hot">
                      clear
                    </button>
                  </div>
                </div>
                <textarea
                  id="resume_text"
                  aria-label="Résumé text"
                  rows={10}
                  maxLength={20_000}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="input area area-mono"
                />
                <p className="count">
                  {resumeText.length.toLocaleString()} / 20,000 · edit anything the parser got wrong
                </p>
                <Explain>
                  This text is what the interviewer actually reads — not the file. If the parser
                  jumbled a two-column layout, fix it here and the questions get better.
                </Explain>
              </div>
            )}

            <div className="mt-7">
              <div className="field-row">
                <label className="label" htmlFor="role">
                  Role
                </label>
                <span className="hint">optional — helps aim the questions</span>
              </div>
              <input
                id="role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={200}
                placeholder="Senior Backend Engineer"
              />
            </div>

            {needsTopic && (
              <div className="mt-7">
                <div className="field-row">
                  <label className="label" htmlFor="topic">
                    Topic
                  </label>
                  <span className="hint">what should it drill you on?</span>
                </div>
                <input
                  id="topic"
                  className="input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={2_000}
                  placeholder="Distributed systems: consistency, partitioning, failure modes…"
                />
              </div>
            )}

            {needsJd && (
              <div className="mt-7">
                <div className="field-row">
                  <label className="label" htmlFor="jd">
                    Job description
                  </label>
                  <span className="hint">the posting you&rsquo;re actually going for</span>
                </div>
                <textarea
                  id="jd"
                  className="input area"
                  rows={6}
                  maxLength={20_000}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Senior Backend Engineer — you'll own our billing pipeline, work in Go and Postgres…"
                />
              </div>
            )}

            {needsProject && (
              <div className="mt-7">
                {/* Two ways in: describe the project, or import a repo. Both land in
                    the same editable textarea — the digest is just a pre-filled
                    starting point, exactly like the parsed résumé. */}
                <div className="seg" role="tablist" aria-label="Project source">
                  {(["paste", "import"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={projectTab === t}
                      onClick={() => setProjectTab(t)}
                    >
                      {t === "paste" ? "Describe it" : "GitHub repo"}
                    </button>
                  ))}
                </div>

                {projectTab === "import" && (
                  <div className="mt-3.5">
                    <div className="repo-row">
                      <input
                        id="repo_url"
                        className="input"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        maxLength={500}
                        placeholder="https://github.com/owner/repo"
                        aria-label="GitHub repository URL"
                        onKeyDown={(e) => {
                          // Enter imports rather than submitting the whole form —
                          // and, now, rather than advancing the wizard past the
                          // material the import is about to supply.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!importing) void importRepo();
                          }
                        }}
                      />
                      {/* No spinner on this one, unlike the submit button:
                          `.spinner` is drawn in `paper` so it can sit on a
                          filled action, and on a bordered button it would be a
                          dark ring on a dark surface. The label already changes,
                          which is the part anyone actually reads. */}
                      <button
                        type="button"
                        className={cx(WBTN, WBTN_SM, WBTN_BACK, "shrink-0")}
                        onClick={() => void importRepo()}
                        disabled={importing || !repoUrl.trim()}
                      >
                        {importing ? "Reading the repo…" : "Import"}
                      </button>
                    </div>
                    {repoInfo && (
                      <div className="repo-meta">
                        <span className="repo-chip">
                          <b>
                            {repoInfo.owner}/{repoInfo.repo}
                          </b>
                          {repoInfo.language ? ` · ${repoInfo.language}` : ""} · ★ {repoInfo.stars}
                        </span>
                        {repoInfo.truncated && (
                          // `.form-note` is unlayered, so a Tailwind margin
                          // utility can't beat its 16px — inline is the only
                          // override that isn't a new CSS rule.
                          <span className="form-note" style={{ marginTop: 0 }}>
                            large repo — imported a partial view; edit the summary to add
                            what&apos;s missing.
                          </span>
                        )}
                      </div>
                    )}
                    <p className="form-note">
                      Public repos only. We read it once and build a summary you can edit — the
                      interview itself never touches GitHub.
                    </p>
                  </div>
                )}

                {(projectTab === "paste" || hasProject) && (
                  <div>
                    <textarea
                      id="project_context"
                      aria-label="Project description"
                      rows={10}
                      maxLength={24_000}
                      value={projectContext}
                      onChange={(e) => setProjectContext(e.target.value)}
                      placeholder="What did you build? Architecture, the hard decisions, what you'd redo, where it breaks…"
                      className="input area area-mono"
                    />
                    <p className="count">
                      {projectContext.length.toLocaleString()} / 24,000
                      {projectRepoUrl ? " · edit anything the parser got wrong" : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── 02 · how hard ───────────────────────────────────────────── */}
        {step === 2 && (
          <section aria-labelledby="wiz-head-2" className="mt-10">
            <h2 id="wiz-head-2" ref={headingRef} tabIndex={-1} className={STEP_LEAD}>
              How hard should it <span className="text-ember">push?</span>
            </h2>
            <p className={STEP_SUB}>
              Difficulty sets what an answer has to contain before it counts as good. What it draws
              on sets where the questions come from.
            </p>

            <div className="mt-8">
              <div className="field-row">
                <span className="label">Difficulty</span>
                <span className="hint">what &ldquo;good&rdquo; has to look like</span>
              </div>
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
              {/* The dial fills the chosen segment in ink, like every other dial
                  on this screen, so the green→red heat ramp has nowhere left to
                  sit on the control itself. It moves to the word that names the
                  level here — still the signal that Extreme is a promise the
                  questions will be brutal, not a flattering job title. */}
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                <b className="font-semibold" style={{ color: heat.color }}>
                  {heat.label}
                </b>{" "}
                — {heat.blurb}
              </p>
            </div>

            <div className="mt-9">
              <div className="field-row">
                <span className="label">What it draws on</span>
                <span className="hint">mix as many as you want</span>
              </div>
              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-muted">
                These combine into one conversation — ticking two doesn&rsquo;t mean two interviews.
              </p>
              <div className={PICKS}>
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

              <div className="or-rule">or</div>

              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-muted">
                These bring their own shape, so they run on their own — picking one clears the mix
                above, and clicking it again gives the mix back.
              </p>
              <div className={PICKS}>
                {MODES.map((m) => (
                  <Pick
                    key={m}
                    selected={mode === m}
                    onClick={() => pickMode(m)}
                    label={MODE_META[m].label}
                    blurb={MODE_META[m].blurb}
                    meta={MODE_NEEDS[m]}
                    kind="radio"
                  />
                ))}
              </div>
              <Explain>
                An interview is <b>either</b> a blend of sources <b>or</b> one of these modes —
                never both. The server enforces the same rule, so a config that mixes them is
                refused rather than quietly half-applied.
              </Explain>
            </div>

            <div className="mt-9">
              <div className="field-row">
                <label className="label" htmlFor="num">
                  Questions
                </label>
                <span className="hint tabular">
                  {numQuestions} · ≈ {estimateMinutes(numQuestions)} min
                </span>
              </div>

              <div className={cx(DIAL, "mb-3")} role="group" aria-label="Common question counts">
                {QUESTION_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={numQuestions === n}
                    onClick={() => setNumQuestions(n)}
                    className={cx(DIALB, numQuestions === n ? DIALB_ON : DIALB_OFF)}
                  >
                    {n} · ≈{estimateMinutes(n)}m
                  </button>
                ))}
              </div>

              <input
                id="num"
                type="range"
                className="range"
                min={QUESTION_BOUNDS.min}
                max={QUESTION_BOUNDS.max}
                value={numQuestions}
                onChange={(e) => setNumQuestions(Number(e.target.value))}
                style={{ "--fill": `${rangePct}%` } as React.CSSProperties}
              />
              <div className="range-ends">
                <span>{QUESTION_BOUNDS.min}</span>
                <span>{QUESTION_BOUNDS.max}</span>
              </div>

              {/* Display only — the start route derives and stores the real cap.
                  More questions means less time for each: say so here rather than
                  let it be discovered by the recorder cutting someone off. */}
              <div className="tally">
                <div>
                  <p className="dk">Questions</p>
                  <p className="dv tabular">{numQuestions}</p>
                </div>
                <div>
                  <p className="dk">Runtime</p>
                  <p className="dv tabular">
                    ≈{estimateMinutes(numQuestions)}
                    <small>min</small>
                  </p>
                </div>
                <div>
                  <p className="dk">Per answer</p>
                  <p className="dv tabular">
                    {answerCap !== null ? (
                      <>
                        {clock(answerCap)}
                        <small>max</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
              </div>
              {answerCap === null && (
                // Honest about a limit this form can reach and the server won't
                // accept: /start refuses a count whose clips can't be scored
                // inside the report's budget.
                <p className="mt-4 text-[12px] leading-relaxed text-weak">
                  At {numQuestions} questions there&rsquo;s no per-answer cap that lets the report
                  build in time — the server will refuse this count. Bring it down.
                </p>
              )}
              <Explain>
                Every answer is analysed clip by clip when the report builds, and that build has a
                fixed budget. More questions therefore buys less time for each one.
              </Explain>
            </div>

            {/* Repeats live here, with the rest of the shape: whether old
                questions can come back is part of how hard this runs. */}
            <div className="switch-row">
              <div>
                <span className="switch-l">Repeat past questions</span>
                <p className="switch-d">
                  {allowRepeats
                    ? "Questions you've already been asked can come up again."
                    : "Every question you've been asked before is off the table."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowRepeats}
                aria-label="Repeat past questions"
                onClick={() => setAllowRepeats((v) => !v)}
                className="switch"
              />
            </div>
          </section>
        )}

        {/* ── 03 · name it and start ──────────────────────────────────── */}
        {step === 3 && (
          <section aria-labelledby="wiz-head-3" className="mt-10">
            <h2 id="wiz-head-3" ref={headingRef} tabIndex={-1} className={STEP_LEAD}>
              What do you want to <span className="text-ember">call it?</span>
            </h2>
            <p className={STEP_SUB}>
              The name is how you&rsquo;ll find this on the dashboard six sessions from now. Nothing
              we could invent would be your words.
            </p>

            {/* The name is borderless and display-sized: it's the title of the
                thing being made, not another field in a stack of fields. */}
            <div className="brief-name-wrap mt-7">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Name this interview…"
                aria-label="Interview name"
                className="brief-name"
              />
              <div className="brief-rule" aria-hidden="true" />
            </div>
            {/* Raw length, like every other counter here: maxLength counts the
                untrimmed value, so a trimmed number would stall short of it. */}
            <p className="count">{name.length} / 80</p>

            {/* Deliberately not the same heading as the rail: this one is the
                last read-back before it costs you twelve seconds and a session,
                and below lg — where the rail is dropped — it is the only copy.
                Not a live region: it restates controls that already announce
                their own value, and the questions slider would fire the whole
                sentence again on every arrow key.

                Celled rather than padded: header, sentence and footnote each get
                their own compartment behind a hairline, which is how every panel
                in the redesign is built. */}
            <div className="mt-9 border border-line bg-paper-raised">
              <p className={cx(MONO_NOTE, "border-b border-line px-5 py-3.5 text-ink-soft")}>
                Read it back
              </p>
              <p className="px-5 py-5 text-[15px] leading-relaxed text-ink">
                {summarySentence({
                  numQuestions,
                  difficultyLabel: heat.label,
                  shapeLabel,
                  minutes: estimateMinutes(numQuestions),
                  answerCap,
                  role: role.trim(),
                })}
              </p>
              <p className="border-t border-line px-5 py-4 text-[13px] leading-relaxed text-ink-soft">
                {allowRepeats
                  ? "Questions you've already been asked can come up again."
                  : "Every question you've been asked before is off the table."}{" "}
                Whether you speak or type each answer — and whether the camera runs — you choose in
                the room, not here.
              </p>
            </div>
          </section>
        )}

        {/* A blocker left on an earlier step, with the way back to it. Almost
            always the shape picked on step 2 asking for material from step 1. */}
        {priorBlock && (
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 border border-dashed border-ember/40 bg-ember/5 px-4 py-3.5">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">{priorBlock.message}</p>
            <button
              type="button"
              className={cx(WBTN, WBTN_SM, WBTN_BACK)}
              onClick={() => goToStep(priorBlock.step)}
            >
              Go to {STEPS[priorBlock.step - 1]?.label}
            </button>
          </div>
        )}

        {/* `key` so a repeated failure shakes again instead of sitting there
            looking like nothing happened. */}
        {error && (
          <p className="error-note mt-6" role="alert" key={error}>
            {error}
          </p>
        )}

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              className={cx(WBTN, WBTN_BACK)}
              onClick={() => goToStep((step - 1) as WizardStep)}
            >
              ← Back
            </button>
          )}
          <span className="hidden flex-1 sm:block" />
          <div className="flex flex-col items-stretch gap-2.5 max-sm:w-full sm:items-end">
            {step < 3 ? (
              <button
                type="submit"
                className={cx(WBTN, WBTN_GO)}
                disabled={working || ownBlock !== null}
                aria-describedby={ownBlock || workingNote ? "wiz-block" : undefined}
              >
                {step === 1 ? "Next — how hard" : "Next — name it"} →
              </button>
            ) : (
              <button
                type="submit"
                className={cx(WBTN, WBTN_GO)}
                disabled={
                  busy || extracting || importing || (!hasResume && !needsProject) || !name.trim()
                }
                aria-describedby={ownBlock || workingNote ? "wiz-block" : undefined}
              >
                {busy ? <span className="spinner" aria-hidden="true" /> : null}
                {busy ? "Writing your first question…" : "Take the hot seat →"}
              </button>
            )}
            {/* Never a disabled button with no reason on it. */}
            {(workingNote || ownBlock) && (
              <p id="wiz-block" className={cx(MONO_NOTE, "sm:text-right")}>
                {workingNote || ownBlock?.message}
              </p>
            )}
          </div>
        </div>

        {step === 3 && (
          <p className="launch-note mt-4">
            You can stop any time — nothing is scored until you finish.
          </p>
        )}
      </div>

      {/* The running sentence. Reads as one line of prose rather than a spec
          table: a candidate can check "an 8-question interview at Medium" against
          what they meant in a single pass, and cannot do that with six rows.
          Dropped below lg, where it would stack under the form as a second copy
          of step 3's read-back rather than sit beside it. */}
      <aside className="rv max-lg:hidden lg:sticky lg:top-6" data-io>
        <div className="border border-line bg-paper-raised">
          <p className={cx(MONO_NOTE, "border-b border-line px-5 py-3.5 text-ink-soft")}>
            What you&rsquo;re about to sit
          </p>
          <p className="border-b border-line px-5 py-5 text-[15px] leading-relaxed text-ink">
            {summarySentence({
              numQuestions,
              difficultyLabel: heat.label,
              shapeLabel,
              minutes: estimateMinutes(numQuestions),
              answerCap,
              role: role.trim(),
            })}
          </p>
          <dl className="py-1.5">
            <Fact k="Draws on" v={shapeLabel || "—"} wrap />
            <Fact k="Difficulty" v={heat.label} />
            <Fact k="Questions" v={String(numQuestions)} />
            <Fact k="Per answer" v={answerCap !== null ? `${clock(answerCap)} max` : "—"} />
            <Fact k="Repeats" v={allowRepeats ? "Allowed" : "Off"} />
            <Fact k="Résumé" v={hasResume ? "Loaded" : needsProject ? "Optional" : "Not yet"} />
            {role.trim() ? <Fact k="Role" v={role.trim()} wrap /> : null}
            {name.trim() ? <Fact k="Name" v={name.trim()} wrap /> : null}
          </dl>
          {/* Inside the panel, not under it: the reference closes the receipt
              with a footed cell, and a floating line of mono outside the border
              read as a caption belonging to the page rather than to the brief.
              This is where the reference puts a second Start button; there isn't
              one here because on steps 1 and 2 the only honest label for it is
              "Next", and a rail CTA that changes what it does per step is worse
              than no rail CTA. */}
          <p className={cx(MONO_NOTE, "border-t border-line px-5 py-4 text-center leading-loose")}>
            Voice or typing is picked in the room
            <br />
            Stop any time — nothing is scored until you finish
          </p>
        </div>
      </aside>
    </form>
  );
}

/**
 * One row of the receipt beside the sentence.
 *
 * `wrap` for anything the user typed: a role or a name can outrun a 330px
 * column, and clipping it leaves no way to read the rest — there's no hover on
 * touch and no second copy of it on screen. Fixed vocabulary stays truncated.
 */
function Fact({ k, v, wrap }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className={FACT_ROW}>
      <dt className="shrink-0 text-ink-muted">{k}</dt>
      <dd className={cx("min-w-0 text-right text-ink", wrap ? "break-words" : "truncate")}>{v}</dd>
    </div>
  );
}

/**
 * The brief as one sentence, live.
 *
 * Only fields that exist are in it. There is no interview "type", no answer mode
 * and no camera flag in the payload, so none of them are asserted here — the two
 * that are real but chosen later are said as exactly that, elsewhere.
 */
function summarySentence({
  numQuestions,
  difficultyLabel,
  shapeLabel,
  minutes,
  answerCap,
  role,
}: {
  numQuestions: number;
  difficultyLabel: string;
  shapeLabel: string;
  minutes: number;
  answerCap: number | null;
  role: string;
}) {
  return (
    <>
      {article(numQuestions)} <b className="font-semibold text-ember">{numQuestions}-question</b>{" "}
      interview at <b className="font-semibold text-ember">{difficultyLabel}</b> difficulty
      {shapeLabel ? (
        <>
          , drawing on <b className="font-semibold text-ember">{shapeLabel}</b>
        </>
      ) : (
        <>, drawing on nothing yet</>
      )}
      {role ? <> for a {role} role</> : null}. Roughly{" "}
      <b className="font-semibold text-ember">{minutes} min</b>
      {answerCap !== null ? <>, up to {clock(answerCap)} per answer</> : null}.
    </>
  );
}

/** Keeps the blend in a stable order however it was clicked together. */
function sourceOrder(a: InterviewSource, b: InterviewSource): number {
  return SOURCES.indexOf(a) - SOURCES.indexOf(b);
}

/**
 * One row in either picker.
 *
 * `kind` drives the ARIA role and nothing else. It used to also round the mark
 * for the radio group; the reference draws both marks as the same square box, so
 * the distinction now lives entirely in the role — which is the only place a
 * screen reader was ever reading it from, and the shape was never announced.
 * Selected state is a class rather than a CSS `aria-checked` selector, but the
 * two are set from the same `selected`, so what's heard and what's seen still
 * cannot disagree.
 */
function Pick({
  selected,
  onClick,
  label,
  blurb,
  meta,
  kind,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  blurb: string;
  meta?: string;
  kind: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={selected}
      onClick={onClick}
      className={cx(PICK, selected && PICK_ON)}
    >
      <span
        className={cx(PICK_BOX, selected ? PICK_BOX_ON : PICK_BOX_OFF)}
        aria-hidden="true"
      >
        {selected ? "✓" : null}
      </span>
      {/* Title and blurb run as one flowing block: the mono uppercase name and
          the sentence that explains it are one thought, and stacking them left a
          ragged column of two-word lines. */}
      <span className="min-w-0">
        <span className={cx(PICK_T, selected ? "text-ember" : "text-ink")}>{label}</span>{" "}
        <span className={PICK_D}>{blurb}</span>
      </span>
      {meta ? <span className={PICK_META}>{meta}</span> : null}
    </button>
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
      <path
        d="M14 3v5h5M9 13h6M9 17h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
