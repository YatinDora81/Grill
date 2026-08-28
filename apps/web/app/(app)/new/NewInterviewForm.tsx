"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Difficulty,
  ExclusiveMode,
  InterviewSource,
  Persona,
  QuestionType,
  StartResponse,
} from "@repo/types";
import { apiGet, apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import {
  DIFFICULTIES,
  DIFFICULTY_META,
  MODE_META,
  PERSONAS,
  PERSONA_META,
  QUESTION_BOUNDS,
  SOURCE_META,
  drillTurnBudget,
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

const QUESTION_PRESETS = [5, 8, 12, 20];

const PENDING_JD_KEY = "grill.pendingJd";
const JD_MAX_CHARS = 20_000;

const PERSONA_SAMPLE: Record<Persona, string> = {
  neutral: "Why that tradeoff?",
  friendly_screen: "That’s helpful — could you take me a level deeper on the migration?",
  terse_staff: "Where does it fall over?",
  bar_raiser: "You said it improved latency — by how much, measured where?",
  skeptic: "And when that cache went stale — what did users see?",
};

interface StarredRow {
  question: string;
  question_type: QuestionType;
  question_hash: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
  language: string;
  stars: number;
  truncated: boolean;
}

interface Check {
  step: WizardStep;
  failed: boolean;
  message: string;
  deferUntilShape?: boolean;
}

const STEPBTN =
  "flex flex-1 items-center gap-2.5 border-r border-line px-3 py-3.5 text-left font-mono text-[10px] tracking-[0.14em] uppercase transition-colors last:border-r-0 sm:px-4";
const STEPBTN_ON = "bg-(--surface-hover) text-ink";
const STEPBTN_OFF = "text-ink-muted hover:bg-(--surface-hover) hover:text-ink-soft";
const STEPNUM = "grid size-6 shrink-0 place-items-center border font-mono text-[10px] leading-none";
const STEPNUM_ON = "border-ember bg-ember font-semibold text-paper";
const STEPNUM_DONE = "border-strong/45 text-strong";
const STEPNUM_OFF = "border-line text-ink-muted";

const DIAL = "flex border border-line";
const DIALB =
  "flex-1 border-r border-line px-2 py-3 text-center font-mono text-[11px] tracking-[0.12em] uppercase transition-colors last:border-r-0";
const DIALB_ON = "bg-ink font-semibold text-paper";
const DIALB_OFF = "text-ink-soft hover:bg-(--surface-hover) hover:text-ink";

const PICKS = "border border-line";
const PICK =
  "grid w-full grid-cols-[auto_1fr] items-start gap-x-4 border-b border-line px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-(--surface-hover) sm:grid-cols-[auto_1fr_auto] sm:px-5";
const PICK_ON = "bg-(--surface-hover) shadow-[inset_3px_0_0_var(--color-ember)]";
const PICK_BOX =
  "mt-0.5 grid size-[18px] shrink-0 place-items-center border text-[10px] leading-none";
const PICK_BOX_ON = "border-ember bg-ember text-paper";
const PICK_BOX_OFF = "border-line-strong";
const PICK_T = "font-mono text-[12px] tracking-[0.1em] uppercase";
const PICK_D = "text-[13px] leading-relaxed text-ink-soft";
const PICK_META =
  "font-mono text-[9.5px] tracking-[0.12em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden";

const WBTN =
  "inline-flex min-h-[52px] items-center justify-center gap-3 border px-6 font-mono text-[11.5px] font-semibold tracking-[0.14em] uppercase transition-colors disabled:cursor-wait disabled:opacity-55";
const WBTN_GO = "border-ink bg-ink text-paper hover:border-ember hover:bg-ember";
const WBTN_BACK = "border-line bg-transparent text-ink hover:border-ember hover:text-ember";
const WBTN_SM = "min-h-[38px] gap-2 px-4 text-[10px]";

const PCARD =
  "relative flex cursor-pointer flex-col border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-ember";
const PCARD_ON = "border-ember bg-ember-soft";
const PCARD_OFF = "border-line-strong hover:bg-(--surface-hover)";

const MONO_NOTE = "font-mono text-[10px] tracking-[0.18em] uppercase text-ink-muted";
const FACT_ROW =
  "flex items-baseline justify-between gap-4 px-5 py-2.5 font-mono text-[11px] tracking-[0.08em] uppercase";
const STEP_LEAD =
  "max-w-[16ch] font-display text-[1.7rem] leading-[1.02] font-extrabold tracking-[-0.02em] uppercase sm:text-[2.15rem]";
const STEP_SUB = "mt-3.5 max-w-[56ch] text-[14px] leading-relaxed text-ink-soft";

function estimateMinutes(n: number): number {
  return Math.max(2, Math.round(n * 1.8));
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function article(n: number): "A" | "An" {
  const s = String(n);
  if (s === "11" || s === "18") return "An";
  return s.startsWith("8") ? "An" : "A";
}

export function NewInterviewForm({
  initialStarredHashes = [],
  initialMode = null,
}: {
  initialStarredHashes?: string[];
  initialMode?: ExclusiveMode | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const [name, setName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const fromDrillLink = initialStarredHashes.length > 0;
  const [sources, setSources] = useState<InterviewSource[]>(
    initialMode || fromDrillLink ? [] : ["resume"],
  );
  const [mode, setMode] = useState<ExclusiveMode | null>(
    initialMode ?? (fromDrillLink ? "starred" : null),
  );
  const [starredHashes, setStarredHashes] = useState<string[]>(initialStarredHashes);
  const [starredRows, setStarredRows] = useState<StarredRow[] | null>(null);
  const [starredFailed, setStarredFailed] = useState(false);
  const [starredReload, setStarredReload] = useState(0);
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
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [persona, setPersona] = useState<Persona>("neutral");
  const [allowRepeats, setAllowRepeats] = useState(false);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [carriedJd, setCarriedJd] = useState(false);

  useEffect(() => {
    if (!initialStarredHashes.length) return;
    let live = true;
    setStarredFailed(false);
    apiGet<{ starred: StarredRow[] }>("/api/starred")
      .then((res) => live && setStarredRows(res.starred))
      .catch(() => live && setStarredFailed(true));
    return () => {
      live = false;
    };
  }, [initialStarredHashes.length, starredReload]);

  useEffect(() => {
    if (fromDrillLink || initialMode) return;
    let handed = "";
    try {
      handed = sessionStorage.getItem(PENDING_JD_KEY) ?? "";
      sessionStorage.removeItem(PENDING_JD_KEY);
    } catch (err) {
      console.warn("[new] could not read the job description handed over by the gap tool:", err);
    }
    const jd = handed.trim().slice(0, JD_MAX_CHARS);
    if (!jd) return;
    setJobDescription(jd);
    setMode("jd");
    setSources([]);
    setCarriedJd(true);
  }, [fromDrillLink, initialMode]);

  const drilling = mode === "starred";
  const drillQuestions = starredRows
    ? starredHashes
        .map((h) => starredRows.find((r) => r.question_hash === h))
        .filter((r): r is StarredRow => r !== undefined)
    : null;
  const drillLost = drillQuestions ? starredHashes.length - drillQuestions.length : 0;
  const liveHashes = drillQuestions ? drillQuestions.map((r) => r.question_hash) : starredHashes;
  const primaryCount = drilling ? liveHashes.length : numQuestions;
  const questionCount = drilling ? drillTurnBudget(liveHashes.length) : numQuestions;
  const answerCap = perAnswerCapSeconds(questionCount);

  const hasResume = resumeText.trim().length > 0;
  const needsTopic = mode === "topic_only" || sources.includes("topic");
  const needsJd = mode === "jd";
  const needsProject = mode === "project";
  const hasProject = projectContext.trim().length > 0;

  const checks: Check[] = [
    {
      step: 3,
      failed: !name.trim(),
      message: "Give this interview a name — it's how you'll find it later.",
    },
    {
      step: 1,
      deferUntilShape: true,
      failed: !hasResume && !needsProject,
      message: "Upload your résumé first — every interview is built around it.",
    },
    {
      step: 2,
      failed: !mode && sources.length === 0,
      message: "Pick what this interview should draw on.",
    },
    {
      step: 2,
      failed: drilling && drillQuestions !== null && drillQuestions.length === 0,
      message: "None of those saved questions are still starred — pick again from Starred.",
    },
    {
      step: 1,
      failed: needsTopic && !topic.trim(),
      message: "Name the topic you want drilled on.",
    },
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

  const deferred = (c: Check) => c.deferUntilShape === true && c.step === step;
  const ownBlock = checks.find((c) => c.failed && c.step === step && !deferred(c)) ?? null;
  const priorBlock = checks.find((c) => c.failed && c.step < step) ?? null;

  function toggleSource(s: InterviewSource) {
    setMode(null);
    setStarredHashes([]);
    setSources((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].sort(sourceOrder),
    );
  }

  function pickMode(m: ExclusiveMode) {
    setStarredHashes([]);
    if (mode === m) {
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

  function moveToStep(n: WizardStep) {
    if (n !== step) moved.current = true;
    setStep(n);
  }

  function goToStep(n: WizardStep) {
    setError("");
    moveToStep(n);
  }

  function goNext() {
    const blocked = checks.find((c) => c.failed && c.step <= step && !deferred(c));
    if (blocked) {
      if (blocked.step !== step) setError(blocked.message);
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
    if (step !== 3) return goNext();

    const blocked = checks.find((c) => c.failed);
    if (blocked) {
      if (blocked.step !== step) setError(blocked.message);
      moveToStep(blocked.step);
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await apiPost<StartResponse>("/api/interview/start", {
        source_text: resumeText.trim(),
        name: name.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
        config: {
          num_questions: questionCount,
          difficulty,
          sources,
          mode,
          allow_repeats: allowRepeats,
          ...(persona !== "neutral" ? { persona } : {}),
          ...(drilling ? { starred_hashes: liveHashes } : {}),
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
      submitting.current = false;
      setBusy(false);
    }
  }

  const heat = DIFFICULTY_META[difficulty];
  const rangePct =
    ((numQuestions - QUESTION_BOUNDS.min) / (QUESTION_BOUNDS.max - QUESTION_BOUNDS.min)) * 100;

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
      <div className="rv min-w-0" data-io>
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
              {step > n && <span className="sr-only">— done</span>}
            </button>
          ))}
        </div>

        {step === 1 && (
          <section aria-labelledby="wiz-head-1" className="mt-10">
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
                <span className="chip">optional</span>
              ) : (
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
                    <span
                      className="mx-auto block size-6 animate-spin rounded-full border-2 border-ember/30 border-t-ember"
                      aria-hidden="true"
                    />
                    <p className="drop-t">Reading {fileName}…</p>
                  </>
                ) : (
                  <>
                    <DocIcon />
                    <p className="drop-t">
                      Drop your résumé here, or <i>browse</i>
                    </p>
                    <p className="drop-d">PDF, DOCX or TXT — up to 20,000 characters</p>
                  </>
                )}
              </label>
            ) : (
              <div className="mt-3">
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
                  maxLength={JD_MAX_CHARS}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Senior Backend Engineer — you'll own our billing pipeline, work in Go and Postgres…"
                />
                {carriedJd && (
                  <p className="mono-note" style={{ marginTop: 8 }}>
                    carried over from the résumé-vs-JD checker · edit anything you want asked about
                  </p>
                )}
              </div>
            )}

            {needsProject && (
              <div className="mt-7">
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
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!importing) void importRepo();
                          }
                        }}
                      />
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
              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                <b className="font-semibold" style={{ color: heat.color }}>
                  {heat.label}
                </b>{" "}
                — {heat.blurb}
              </p>
            </div>

            <PersonaPicker value={persona} onPick={setPersona} />

            {drilling && (
              <>
                <div className="mt-9 border border-ember bg-ember-soft">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-(--edge-heat-strong) px-5 py-3.5">
                    <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
                      M&mdash;07 · {MODE_META.starred.label}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setStarredHashes([]);
                        setMode(null);
                        setSources(["resume"]);
                      }}
                      className="underlink hot"
                    >
                      drop the drill
                    </button>
                  </div>
                  <p className="px-5 pt-4 text-[13px] leading-relaxed text-ink-soft">
                    {MODE_META.starred.blurb} Follow-ups stay adaptive; the rest of the brief below
                    still applies.
                  </p>
                  <ol className="px-5 pt-4 pb-5">
                    {drillQuestions === null ? (
                      starredFailed ? (
                        <li className="text-[13px] leading-relaxed text-weak">
                          Couldn&rsquo;t read your saved questions.{" "}
                          <button
                            type="button"
                            onClick={() => setStarredReload((n) => n + 1)}
                            className="underlink hot"
                          >
                            try again
                          </button>
                        </li>
                      ) : (
                        <li className={MONO_NOTE}>Reading your saved questions…</li>
                      )
                    ) : drillQuestions.length === 0 ? (
                      <li className="text-[13px] leading-relaxed text-weak">
                        None of those are still starred.{" "}
                        <Link href="/starred" className="underlink">
                          pick again
                        </Link>
                      </li>
                    ) : (
                      drillQuestions.map((q, i) => (
                        <li
                          key={q.question_hash}
                          className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3.5 border-b border-(--edge-heat) py-2.5 last:border-b-0"
                        >
                          <span className="font-mono text-[11px] leading-6 tracking-[0.1em] text-ember tabular">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-[14px] leading-relaxed text-ink">{q.question}</span>
                          <span className="font-mono text-[9.5px] tracking-[0.12em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden">
                            {q.question_type === "followup" ? "follow-up" : q.question_type}
                          </span>
                        </li>
                      ))
                    )}
                  </ol>
                  {drillLost > 0 && drillQuestions && drillQuestions.length > 0 && (
                    <p className={cx(MONO_NOTE, "border-t border-(--edge-heat) px-5 py-3")}>
                      {drillLost} of them {drillLost === 1 ? "was" : "were"} unstarred since —
                      dropped
                    </p>
                  )}
                </div>
                <Explain>
                  A drill asks <b>exactly these</b>, word for word, in this order. The question
                  count is the length of the list plus room for a follow-up after each, so the
                  slider below is off — and the grading is the same rubric as any other interview.
                </Explain>
              </>
            )}

            <div className="mt-9">
              <div className="field-row">
                <span id="wiz-draws-on" className="label">
                  What it draws on
                </span>
                <span className="hint">
                  {drilling ? "set by the drill" : "mix as many as you want"}
                </span>
              </div>
              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-muted">
                These combine into one conversation — ticking two doesn&rsquo;t mean two interviews.
              </p>
              <div className={PICKS} role="group" aria-labelledby="wiz-draws-on">
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
              <div className={PICKS} role="radiogroup" aria-label="Interview mode">
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
                {drilling ? (
                  <span className="label">Questions</span>
                ) : (
                  <label className="label" htmlFor="num">
                    Questions
                  </label>
                )}
                <span className="hint tabular">
                  {questionCount} · ≈ {estimateMinutes(questionCount)} min
                </span>
              </div>

              {drilling ? (
                <p className="border border-line bg-paper-sunken px-5 py-4 text-[13px] leading-relaxed text-ink-soft">
                  Fixed at <b className="font-semibold text-ember">{primaryCount}</b> — one primary
                  per starred question, plus room for a follow-up after each. Drop the drill above
                  to set this yourself.
                </p>
              ) : (
                <>
                  <div
                    className={cx(DIAL, "mb-3")}
                    role="group"
                    aria-label="Common question counts"
                  >
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
                </>
              )}

              <div className="tally">
                <div>
                  <p className="dk">Questions</p>
                  <p className="dv tabular">{questionCount}</p>
                </div>
                <div>
                  <p className="dk">Runtime</p>
                  <p className="dv tabular">
                    ≈{estimateMinutes(questionCount)}
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
                <p className="mt-4 text-[12px] leading-relaxed text-weak">
                  At {questionCount} questions there&rsquo;s no per-answer cap that lets the report
                  build in time — the server will refuse this count. Bring it down.
                </p>
              )}
              <Explain>
                Every answer is analysed clip by clip when the report builds, and that build has a
                fixed budget. More questions therefore buys less time for each one.
              </Explain>
            </div>

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

        {step === 3 && (
          <section aria-labelledby="wiz-head-3" className="mt-10">
            <h2 id="wiz-head-3" ref={headingRef} tabIndex={-1} className={STEP_LEAD}>
              What do you want to <span className="text-ember">call it?</span>
            </h2>
            <p className={STEP_SUB}>
              The name is how you&rsquo;ll find this on the dashboard six sessions from now. Nothing
              we could invent would be your words.
            </p>

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
            <p className="count">{name.length} / 80</p>

            <div className="mt-9 border border-line bg-paper-raised">
              <p className={cx(MONO_NOTE, "border-b border-line px-5 py-3.5 text-ink-soft")}>
                Read it back
              </p>
              <p className="px-5 py-5 text-[15px] leading-relaxed text-ink">
                {summarySentence({
                  numQuestions: questionCount,
                  difficultyLabel: heat.label,
                  shapeLabel,
                  minutes: estimateMinutes(questionCount),
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

        {priorBlock && (
          <div
            /* `--wash-heat` rather than `bg-ember/5`: the strength of an ember
               tint has to travel with the ember, which is a lamp on dark and a
               spot plate on light. One token keeps this banner and the status
               chips it echoes from drifting apart. */
            className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 border border-dashed border-ember/40 bg-(--wash-heat) px-4 py-3.5"
          >
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

      <aside className="rv max-lg:hidden lg:sticky lg:top-6" data-io>
        <div className="border border-line bg-paper-raised">
          <p className={cx(MONO_NOTE, "border-b border-line px-5 py-3.5 text-ink-soft")}>
            What you&rsquo;re about to sit
          </p>
          <p className="border-b border-line px-5 py-5 text-[15px] leading-relaxed text-ink">
            {summarySentence({
              numQuestions: questionCount,
              difficultyLabel: heat.label,
              shapeLabel,
              minutes: estimateMinutes(questionCount),
              answerCap,
              role: role.trim(),
            })}
          </p>
          <dl className="py-1.5">
            <Fact k="Draws on" v={shapeLabel || "—"} wrap />
            <Fact k="Difficulty" v={heat.label} />
            <Fact k="Questions" v={String(questionCount)} />
            <Fact k="Interviewer" v={PERSONA_META[persona].label} />
            <Fact k="Per answer" v={answerCap !== null ? `${clock(answerCap)} max` : "—"} />
            <Fact k="Repeats" v={allowRepeats ? "Allowed" : "Off"} />
            <Fact k="Résumé" v={hasResume ? "Loaded" : needsProject ? "Optional" : "Not yet"} />
            {role.trim() ? <Fact k="Role" v={role.trim()} wrap /> : null}
            {name.trim() ? <Fact k="Name" v={name.trim()} wrap /> : null}
          </dl>
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

function Fact({ k, v, wrap }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className={FACT_ROW}>
      <dt className="shrink-0 text-ink-muted">{k}</dt>
      <dd className={cx("min-w-0 text-right text-ink", wrap ? "break-words" : "truncate")}>{v}</dd>
    </div>
  );
}

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

function PersonaPicker({ value, onPick }: { value: Persona; onPick: (p: Persona) => void }) {
  return (
    <fieldset className="mt-9">
      <legend className="sr-only">Interviewer persona</legend>
      <div className="field-row">
        <span className="label">Interviewer</span>
        <span className="hint">voice, not grading</span>
      </div>
      <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
        {PERSONAS.map((p) => {
          const on = value === p;
          return (
            <label key={p} className={cx(PCARD, on ? PCARD_ON : PCARD_OFF)}>
              <input
                type="radio"
                name="persona"
                value={p}
                checked={on}
                onChange={() => onPick(p)}
                className="sr-only"
              />
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-[16px] font-bold tracking-[0.01em]">
                  {PERSONA_META[p].label}
                </span>
                {on && (
                  <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ember">
                    Selected
                  </span>
                )}
              </span>
              <span className="mt-0.5 mb-2.5 text-[13px] leading-relaxed text-ink-soft">
                {PERSONA_META[p].tagline}
              </span>
              <span
                className={cx(
                  "mt-auto font-mono text-[12px] leading-relaxed",
                  on ? "text-ink-soft" : "text-ink-muted",
                )}
              >
                &ldquo;{PERSONA_SAMPLE[p]}&rdquo;
              </span>
            </label>
          );
        })}
      </div>
      <Explain>
        Persona changes the <b>voice</b>, not the grading — every persona is scored on the same
        rubric, and the sample line above is only how it sounds.
      </Explain>
    </fieldset>
  );
}

function sourceOrder(a: InterviewSource, b: InterviewSource): number {
  return SOURCES.indexOf(a) - SOURCES.indexOf(b);
}

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
      <span className={cx(PICK_BOX, selected ? PICK_BOX_ON : PICK_BOX_OFF)} aria-hidden="true">
        {selected ? "✓" : null}
      </span>
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
