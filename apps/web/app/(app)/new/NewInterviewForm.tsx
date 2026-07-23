"use client";

import { useRef, useState } from "react";
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

/** What /api/interview/project/extract returns for the imported repo. */
interface RepoInfo {
  owner: string;
  repo: string;
  language: string;
  stars: number;
  truncated: boolean;
}

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
      // still overwrite it.
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
    if (!name.trim())
      return setError("Give this interview a name — it's how you'll find it later.");
    // A project interview brings its own material, so the résumé is optional
    // there and only there — every other shape is built around it.
    if (!hasResume && !needsProject)
      return setError("Upload your résumé first — every interview is built around it.");
    if (!mode && sources.length === 0) return setError("Pick what this interview should draw on.");
    if (needsTopic && !topic.trim()) return setError("Name the topic you want drilled on.");
    if (needsJd && !jobDescription.trim())
      return setError("Paste the job description you're going for.");
    if (needsProject && !hasProject)
      return setError("Describe the project, or import a GitHub repo.");

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

  return (
    <form onSubmit={onSubmit} className="brief">
      {/* The name leads, borderless and display-sized: it's the title of the
          thing being made, not another field in a stack of fields. */}
      <div className="brief-name-wrap rv" data-io>
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

      {/* ── 01 · the shape ────────────────────────────────────────────── */}
      <section className="card card-hairline rv" data-io>
        <div className="bstep-head">
          <span className="bstep-n" aria-hidden="true">
            01
          </span>
          <div>
            <h2 className="bstep-t">What kind of interview</h2>
            <p className="bstep-d">Blend sources into one conversation, or hand it a mode.</p>
          </div>
        </div>

        <p className="form-note">Mix as many as you want — it stays one conversation.</p>
        <div className="pick-grid-3">
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

        <p className="form-note" style={{ marginTop: 0 }}>
          These bring their own shape, so they run on their own. Cultural only ignores your résumé —
          use it for a pure culture-fit screen.
        </p>
        <div className="pick-grid-2">
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
          <div style={{ marginTop: 20 }}>
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
          <div style={{ marginTop: 20 }}>
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
          <div style={{ marginTop: 20 }}>
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
              <div style={{ marginTop: 14 }}>
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
                      // Enter imports rather than submitting the whole form.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!importing) void importRepo();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void importRepo()}
                    disabled={importing || !repoUrl.trim()}
                  >
                    {importing ? <span className="spinner" aria-hidden="true" /> : null}
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
                        large repo — imported a partial view; edit the summary to add what&apos;s
                        missing.
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

        {/* Repeats live here, not in "shape": whether old questions can come
            back is part of what kind of interview this is. */}
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

      {/* ── 02 · the material ─────────────────────────────────────────── */}
      <section className="card card-hairline rv" data-io>
        <div className="bstep-head">
          <span className="bstep-n" aria-hidden="true">
            02
          </span>
          <div>
            <h2 className="bstep-t">The material</h2>
            <p className="bstep-d">Your résumé — the interviewer reads it before you sit down.</p>
          </div>
          <span className="bstep-status">
            {hasResume ? (
              <span className="chip chip-ok">✓ loaded</span>
            ) : needsProject ? (
              // A project interview brings its own material — the résumé is only
              // ever background here, so it isn't required.
              <span className="chip">optional</span>
            ) : (
              <span className="chip chip-req">required</span>
            )}
          </span>
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
                <span
                  className="spinner"
                  aria-hidden="true"
                  style={{
                    borderColor: "color-mix(in srgb, var(--color-ember) 30%, transparent)",
                    borderTopColor: "var(--color-ember)",
                  }}
                />
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
          <div>
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
          </div>
        )}
      </section>

      {/* ── 03 · the heat ─────────────────────────────────────────────── */}
      <section className="card card-hairline rv" data-io>
        <div className="bstep-head">
          <span className="bstep-n" aria-hidden="true">
            03
          </span>
          <div>
            <h2 className="bstep-t">The heat</h2>
            <p className="bstep-d">Role, difficulty, and how long you&rsquo;ll be in the seat.</p>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
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

        {/* Colour is the signal: green is warm-up, red is a promise the
            questions will be brutal — not a flattering job title. */}
        <div style={{ marginTop: 22 }}>
          <div className="flabel-row">
            <span className="flabel">Difficulty</span>
            <span className="heat-chip" style={{ "--heat": heat.color } as React.CSSProperties}>
              {heat.label}
            </span>
          </div>
          <div className="heat-grid" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => {
              const m = DIFFICULTY_META[d];
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === d}
                  onClick={() => setDifficulty(d)}
                  className="heat"
                  style={{ "--heat": m.color } as React.CSSProperties}
                >
                  <span className="heat-dot" aria-hidden="true" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="heat-blurb">{heat.blurb}</p>
        </div>

        <div style={{ marginTop: 22 }}>
          <div className="flabel-row">
            <label className="flabel" htmlFor="num">
              Questions
            </label>
            <span className="flabel-v">
              {numQuestions}
              <small>≈ {estimateMinutes(numQuestions)} min</small>
            </span>
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
        </div>
      </section>

      {/* `key` so a repeated failure shakes again instead of sitting there
          looking like nothing happened. */}
      {error && (
        <p className="error-note" role="alert" key={error}>
          {error}
        </p>
      )}

      <div className="launch rv" data-io>
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={
            busy || extracting || importing || (!hasResume && !needsProject) || !name.trim()
          }
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {busy ? "Writing your first question…" : "Take the hot seat"}
        </button>
        <p className="launch-note">You can stop any time — nothing is scored until you finish.</p>
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
 * has no other way to know which of the two groups it's in. The CSS keys its
 * selected state off `aria-checked`, so what's heard and what's seen can never
 * disagree.
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
    <button type="button" role={kind} aria-checked={selected} onClick={onClick} className="pick">
      <span className="pick-top">
        <span className={cx("pick-mark", kind === "radio" && "round")} aria-hidden="true" />
        <span className="pick-l">{label}</span>
      </span>
      <span className="pick-d">{blurb}</span>
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
      style={{ margin: "0 auto", color: "var(--color-ink-muted)" }}
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
