import type { CodeLanguage } from "@repo/types";

export interface RunRequest {
  language: CodeLanguage;
  source: string;
  stdin: string;
  timeoutMs: number;
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  time_ms: number;
  timed_out: boolean;
}

type WorkerMsg =
  | { type: "ready" }
  | { type: "result"; id: number; stdout: string; stderr: string; time_ms: number }
  | { type: "error"; id?: number; message: string };

class WorkerRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (o: RunOutput) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly url: string,
    private readonly loadMsg?: Record<string, unknown>,
  ) {}

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.url);
    w.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const m = e.data;
      if (m.type === "ready") return;
      if (m.type === "error" && m.id === undefined) {
        console.warn(`[runner] ${this.url}:`, m.message);
        return;
      }
      const id = m.type === "result" ? m.id : m.id!;
      const p = this.pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve(
        m.type === "result"
          ? { stdout: m.stdout, stderr: m.stderr, time_ms: m.time_ms, timed_out: false }
          : { stdout: "", stderr: m.message, time_ms: 0, timed_out: false },
      );
    };
    w.onerror = (err) => console.warn(`[runner] ${this.url} crashed:`, err.message);
    if (this.loadMsg) w.postMessage(this.loadMsg);
    this.worker = w;
    return w;
  }

  warmUp(): void {
    if (typeof Worker === "undefined") return;
    this.spawn();
  }

  run(req: RunRequest): Promise<RunOutput> {
    const w = this.spawn();
    const id = this.nextId++;
    return new Promise<RunOutput>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        resolve({
          stdout: "",
          stderr: `Timed out after ${req.timeoutMs} ms`,
          time_ms: req.timeoutMs,
          timed_out: true,
        });
      }, req.timeoutMs);
      this.pending.set(id, { resolve, timer });
      w.postMessage({
        ...(this.loadMsg ?? {}),
        type: "run",
        id,
        source: req.source,
        stdin: req.stdin,
      });
    });
  }

  kill(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) clearTimeout(p.timer);
    this.pending.clear();
  }
}

const PYODIDE_URL =
  process.env.NEXT_PUBLIC_PYODIDE_URL || "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";

const runners: Record<CodeLanguage, WorkerRunner> = {
  python: new WorkerRunner("/workers/py-runner.js", { type: "load", indexURL: PYODIDE_URL }),
  javascript: new WorkerRunner("/workers/js-runner.js"),
};

export function warmUp(language: CodeLanguage): void {
  runners[language].warmUp();
}

export function runCode(req: RunRequest): Promise<RunOutput> {
  return runners[req.language].run(req);
}

export function killRunners(): void {
  runners.python.kill();
  runners.javascript.kill();
}

export function compareOutput(actual: string, expected: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");
  return norm(actual) === norm(expected);
}
