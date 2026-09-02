"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import type {
  AnswerResponse,
  CodeLanguage,
  CodingExample,
  CodingQuestionPayload,
  EndResponse,
  Persona,
  RunResult,
} from "@repo/types";
import { apiGet, apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { personaLabel } from "@/lib/interviewMeta";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { MiniMarkdown } from "@/components/MiniMarkdown";
import { compareOutput, killRunners, runCode, warmUp } from "@/lib/code/runner";
import { useKeystrokes } from "@/hooks/useKeystrokes";
import { useRecorder } from "./useRecorder";
import { useSessionVideo } from "./useSessionVideo";
import { Progress, RecDot, ThankYou, fmtTime, useQuit, useRoomTheme } from "./RoomChrome";

interface Props {
  sessionId: string;
  name: string | null;
  role: string | null;
  numQuestions: number;
  answered: number;
  turnIndex: number;
  payload: CodingQuestionPayload;
  maxSeconds: number;
  maxBytes: number;
  persona: Persona | null;
  videoBitrate: number;
}

type Phase = "briefing" | "coding" | "sending" | "finishing";

const RUN_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_CODE_RUN_TIMEOUT_MS) || 8_000;

const OUTPUT_MAX = 20_000;

const STALE_CODES = new Set(["turn_already_answered", "unknown_turn", "session_not_active"]);

function isStale(err: unknown): boolean {
  return err instanceof ApiClientError && STALE_CODES.has(err.code);
}

const LANGUAGES: { id: CodeLanguage; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
];

const SEAT_BANNER = "flex-none border-b border-line bg-paper-raised/60";
const SEAT_BANNER_IN =
  "mx-auto flex max-w-[1320px] items-center gap-2.5 px-[18px] py-1.5 font-mono text-[10.5px] tracking-[0.16em] text-ink uppercase sm:gap-3 sm:px-6 sm:py-2";

const PILL =
  "border-r border-line px-3 py-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase transition-colors last:border-r-0 disabled:opacity-50";
const PILL_ON = "bg-ink font-semibold text-paper";
const PILL_OFF = "text-ink-soft hover:bg-(--surface-hover) hover:text-ink";

const TOOL_BTN =
  "border border-line px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase transition-colors hover:border-ember hover:text-ember disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-soft";

function cap(s: string): string {
  return s.length > OUTPUT_MAX ? s.slice(0, OUTPUT_MAX) : s;
}

export function CodeSeat(props: Props) {
  const router = useRouter();
  const rec = useRecorder(props.maxSeconds);
  const video = useSessionVideo(props.sessionId, props.videoBitrate);
  const theme = useRoomTheme();

  const [language, setLanguage] = useState<CodeLanguage>("python");
  const [source, setSource] = useState(props.payload.starter.python);
  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [error, setError] = useState("");
  const [canRun, setCanRun] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const shownAt = useRef(performance.now());
  const keys = useKeystrokes(shownAt.current);
  const finishVideo = useRef<Promise<void> | null>(null);
  const capFired = useRef(false);

  const busy = phase === "sending" || phase === "finishing";
  const extensions = useMemo(() => [language === "python" ? python() : javascript()], [language]);

  useEffect(() => setCanRun(typeof Worker !== "undefined"), []);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    warmUp(language);
  }, [language]);

  useEffect(() => () => killRunners(), []);

  useEffect(() => {
    if (phase === "briefing" && rec.state === "recording") setPhase("coding");
  }, [phase, rec.state]);

  useEffect(() => {
    if (phase !== "coding") return;
    const t = setInterval(
      () => setElapsed(Math.round((performance.now() - shownAt.current) / 1_000)),
      1_000,
    );
    return () => clearInterval(t);
  }, [phase]);

  const quit = useQuit(props.sessionId, () => {
    rec.reset();
    killRunners();
    video.stream?.getTracks().forEach((t) => t.stop());
  });

  function switchLanguage(next: CodeLanguage) {
    if (next === language || busy) return;
    const untouched = !source.trim() || source === props.payload.starter[language];
    if (
      !untouched &&
      !confirm(`Switch to ${next === "python" ? "Python" : "JavaScript"}? This replaces your code.`)
    ) {
      return;
    }
    setLanguage(next);
    setSource(props.payload.starter[next]);
    setResults([]);
  }

  async function execute(cases: CodingExample[], kind: RunResult["kind"]): Promise<RunResult[]> {
    const out: RunResult[] = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      const r = await runCode({ language, source, stdin: c.input, timeoutMs: RUN_TIMEOUT_MS });
      out.push({
        index: i,
        kind,
        passed: !r.timed_out && !r.stderr && compareOutput(r.stdout, c.output),
        stdout: cap(r.stdout),
        stderr: cap(r.stderr),
        expected: cap(c.output),
        time_ms: r.time_ms,
        timed_out: r.timed_out,
      });
    }
    return out;
  }

  async function runExamples() {
    if (!canRun || running || busy) return;
    setRunning(true);
    setError("");
    try {
      const rs = await execute(props.payload.examples, "example");
      setResults(rs);
      keys.onRun(rs.filter((r) => r.passed).length, rs.length);
    } catch (err) {
      console.warn("[code] the runner failed:", err);
      setError("The runner stopped responding. Try running it again.");
    } finally {
      setRunning(false);
    }
  }

  async function hiddenTests(): Promise<CodingExample[]> {
    try {
      const res = await apiGet<{ hidden_tests: CodingExample[] }>(
        `/api/interview/coding/tests?session_id=${encodeURIComponent(props.sessionId)}&turn_index=${props.turnIndex}`,
      );
      return res.hidden_tests;
    } catch (err) {
      console.warn("[code] hidden tests unavailable:", err);
      return [];
    }
  }

  async function submit() {
    if (running || busy) return;

    let all: RunResult[] = [];
    if (canRun) {
      setRunning(true);
      try {
        const examples = await execute(props.payload.examples, "example");
        const hidden = await execute(await hiddenTests(), "hidden");
        all = [...examples, ...hidden];
        setResults(all);
        keys.onRun(all.filter((r) => r.passed).length, all.length);
      } catch (err) {
        console.warn("[code] the runner failed on submit:", err);
      } finally {
        setRunning(false);
      }
    }

    setPhase("sending");
    setError("");
    const send = async () => {
      const blob = await rec.stop();
      const form = new FormData();
      form.append("session_id", props.sessionId);
      form.append("turn_index", String(props.turnIndex));
      form.append(
        "payload",
        JSON.stringify({ language, source, results: all, keystrokes: keys.finish() }),
      );
      if (blob && blob.size <= props.maxBytes) {
        form.append("audio", blob, `turn_${props.turnIndex}.webm`);
      }
      const res = await apiPostForm<AnswerResponse>("/api/interview/answer-code", form);
      if (res.done) {
        setPhase("finishing");
        finishVideo.current = video.finish();
        try {
          await apiPost<EndResponse>("/api/interview/end", { session_id: props.sessionId });
        } catch {}
        return;
      }
      router.refresh();
    };

    try {
      await toast.promise(send(), {
        loading: "Sending your code…",
        success: "Code in — the interviewer is reading it",
        error: (err: unknown) =>
          isStale(err)
            ? "You're already past this one — catching up…"
            : err instanceof ApiClientError
              ? err.message
              : "Couldn't send that submission.",
      });
    } catch (err) {
      if (isStale(err)) {
        setError("");
        router.refresh();
        return;
      }
      setError(err instanceof ApiClientError ? err.message : "Couldn't send that submission.");
      setPhase("coding");
    }
  }

  const capSubmit = useRef(submit);
  capSubmit.current = submit;
  useEffect(() => {
    if (!rec.capped || phase !== "coding" || capFired.current) return;
    capFired.current = true;
    void capSubmit.current();
  }, [rec.capped, phase]);

  if (phase === "finishing") {
    return <ThankYou sessionId={props.sessionId} saving={finishVideo.current} />;
  }

  const currentQ = Math.min(props.answered + 1, props.numQuestions);
  const passed = results.filter((r) => r.passed).length;
  const micOff = !rec.supported || rec.state === "denied";

  return (
    <div className="room-root">
      <div className="grain" aria-hidden="true" />
      <GrillToaster />

      <header className="room-top">
        <div className="room-top-in">
          <div className="room-id">
            <p className="room-name">{props.name?.trim() || props.role?.trim() || "Interview"}</p>
            <p className="room-meta">
              <b>Q{currentQ}</b> / {props.numQuestions}
              {props.name && props.role ? ` · ${props.role}` : ""}
            </p>
          </div>

          <Progress answered={props.answered} total={props.numQuestions} />

          <div className="room-ctl">
            <span className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden">
              {personaLabel(props.persona)}
            </span>
            <RecDot state={video.state} />
            <button onClick={quit} disabled={busy} className="underlink">
              Leave
            </button>
          </div>
        </div>
      </header>

      <div className={SEAT_BANNER} aria-live="polite">
        <div className={SEAT_BANNER_IN}>
          <span
            aria-hidden="true"
            className={cx(
              "size-2 flex-none rounded-full",
              phase === "coding" && rec.state === "recording"
                ? "bg-ember animate-pulse-rec"
                : "bg-mixed",
            )}
          />
          <span className="min-w-0 truncate">
            {phase === "sending"
              ? "Got it — running the tests and scoring the code"
              : phase === "briefing"
                ? "Read the problem, then start when you're ready"
                : rec.state === "recording"
                  ? "Coding — the mic is open, talk it through"
                  : "Coding — no mic on this one"}
          </span>
          <em className="truncate not-italic tracking-[0.1em] text-ink-muted max-sm:hidden">
            ·{" "}
            {phase === "briefing"
              ? "the clock starts when you do"
              : "run the examples as often as you like"}
          </em>
        </div>
      </div>

      <main className="room-main">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                Problem {Math.ceil(currentQ / 2)} · technical
              </p>
              <h1 className="mt-2 font-display text-[22px] leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[26px]">
                {props.payload.title}
              </h1>
              {props.payload.complexity_target ? (
                <p className="mt-2.5 inline-block border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-ink-muted uppercase">
                  target · {props.payload.complexity_target}
                </p>
              ) : null}

              <div className="mt-4">
                <MiniMarkdown text={props.payload.prompt_markdown} />
              </div>

              <div className="mt-6">
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                  Examples
                </p>
                <div className="mt-2 grid gap-3">
                  {props.payload.examples.map((ex, i) => (
                    <div key={i} className="border border-line p-3">
                      <p className="font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">
                        input
                      </p>
                      <pre className="code-src mt-1">{ex.input}</pre>
                      <p className="mt-2 font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">
                        output
                      </p>
                      <pre className="code-src mt-1">{ex.output}</pre>
                      {ex.explanation ? (
                        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                          {ex.explanation}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {phase === "briefing" && (
                <div className="mt-7">
                  {micOff ? (
                    <button onClick={() => setPhase("coding")} className="btn btn-primary">
                      Start without the mic
                    </button>
                  ) : (
                    <button
                      onClick={() => rec.start()}
                      disabled={rec.state === "requesting"}
                      className="btn btn-primary"
                    >
                      {rec.state === "requesting"
                        ? "Waiting for the mic…"
                        : "Start the problem — mic on"}
                    </button>
                  )}
                  <p className="mt-3 max-w-[52ch] font-mono text-[10px] leading-relaxed tracking-[0.14em] text-ink-muted uppercase">
                    {micOff
                      ? "No microphone on this one — the code is still scored, but think-aloud goes unmeasured."
                      : "The mic records the whole problem so the report can measure how much you talked while coding."}
                  </p>
                </div>
              )}
            </section>

            <section className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-2 border border-line p-2">
                <div className="flex border border-line" role="radiogroup" aria-label="Language">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={language === l.id}
                      onClick={() => switchLanguage(l.id)}
                      disabled={busy || running}
                      className={cx(PILL, language === l.id ? PILL_ON : PILL_OFF)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void runExamples()}
                  disabled={phase !== "coding" || running || !canRun}
                  className={TOOL_BTN}
                >
                  {running ? "Running…" : "Run examples"}
                </button>

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={phase !== "coding" || running}
                  className={cx(TOOL_BTN, "border-ink bg-ink text-paper hover:bg-ember")}
                >
                  {busy ? "Sending…" : "Submit"}
                </button>

                <span className="ml-auto font-mono text-[10.5px] tracking-[0.14em] text-ink-muted uppercase tabular-nums">
                  {fmtTime(rec.state === "recording" ? rec.seconds : elapsed)}
                  {rec.state === "recording"
                    ? ` · ${fmtTime(Math.max(0, props.maxSeconds - rec.seconds))} left`
                    : ""}
                </span>
              </div>

              <div className="mt-2 h-[clamp(300px,50vh,640px)] border border-line">
                <CodeMirror
                  value={source}
                  height="100%"
                  theme={theme}
                  editable={phase === "coding"}
                  extensions={extensions}
                  basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
                  onChange={(next) => {
                    keys.onEdit(source.length, next.length);
                    setSource(next);
                  }}
                />
              </div>

              {!canRun && (
                <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-mixed uppercase">
                  This browser can&apos;t run code in a worker — write your solution and submit it;
                  it is read and scored, just without test results.
                </p>
              )}

              {(error || rec.error) && (
                <p className="error-note mt-3" role="alert" key={error || rec.error}>
                  {error || rec.error}
                </p>
              )}

              {results.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                    Results · {passed}/{results.length} passed
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    {results.map((r) => (
                      <Result key={`${r.kind}-${r.index}`} result={r} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="room-foot">
        <p>Your code runs in this tab — nothing is executed on a server.</p>
        <p>
          The mic stays on so the report can measure how much you talked while coding.
        </p>
      </footer>
    </div>
  );
}

function Result({ result: r }: { result: RunResult }) {
  const [open, setOpen] = useState(true);
  const hidden = r.kind === "hidden";
  const failed = !r.passed;

  return (
    <div
      className="border-l-2 py-1.5 pl-3"
      style={{ borderColor: r.passed ? "var(--track-strong)" : "var(--edge-verdict-weak)" }}
    >
      <p className="font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">
        {hidden ? "hidden" : "example"} #{r.index + 1} ·{" "}
        <b className={r.passed ? "text-strong" : "text-weak"}>
          {r.timed_out ? "timed out" : r.passed ? "pass" : "fail"}
        </b>{" "}
        · {r.time_ms} ms
        {failed && !hidden ? (
          <button onClick={() => setOpen((o) => !o)} className="underlink ml-3">
            {open ? "hide" : "why"}
          </button>
        ) : null}
      </p>
      {failed && !hidden && open ? (
        <div className="mt-1.5 grid gap-1">
          <p className="font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">
            expected
          </p>
          <pre className="code-src">{r.expected || "(nothing)"}</pre>
          <p className="font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">got</p>
          <pre className="code-src">{r.stdout || "(nothing)"}</pre>
          {r.stderr ? (
            <>
              <p className="font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">
                stderr
              </p>
              <pre className="code-src">{r.stderr}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
