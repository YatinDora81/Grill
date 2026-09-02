import { describe, expect, test } from "bun:test";
import { compareOutput, killRunners, runCode } from "./runner";

describe("compareOutput", () => {
  test("identical output matches", () => {
    expect(compareOutput("7\n", "7\n")).toBe(true);
  });

  test("trailing spaces on a line are ignored", () => {
    expect(compareOutput("hello   \nworld\t\n", "hello\nworld\n")).toBe(true);
  });

  test("trailing newlines are ignored on either side", () => {
    expect(compareOutput("3", "3\n\n\n")).toBe(true);
    expect(compareOutput("3\n\n", "3")).toBe(true);
  });

  test("windows line endings match unix ones", () => {
    expect(compareOutput("a\r\nb\r\n", "a\nb\n")).toBe(true);
  });

  test("leading whitespace still counts", () => {
    expect(compareOutput("  3", "3")).toBe(false);
  });

  test("blank lines in the middle still count", () => {
    expect(compareOutput("a\n\nb", "a\nb")).toBe(false);
  });

  test("different content fails", () => {
    expect(compareOutput("6\n", "7\n")).toBe(false);
  });

  test("an empty run does not pass a non-empty expectation", () => {
    expect(compareOutput("", "0")).toBe(false);
    expect(compareOutput("\n\n", "")).toBe(true);
  });
});

describe("the message a run posts to its worker", () => {
  test("stays a run even though the loader url rides along with it", async () => {
    const sent: Record<string, unknown>[] = [];
    class StubWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      postMessage(msg: Record<string, unknown>) {
        sent.push(msg);
        if (msg.type === "run") {
          this.onmessage?.({
            data: { type: "result", id: msg.id, stdout: "7", stderr: "", time_ms: 3 },
          } as MessageEvent);
        }
      }
      terminate() {}
    }
    const prior = globalThis.Worker;
    globalThis.Worker = StubWorker as unknown as typeof Worker;
    try {
      const out = await runCode({
        language: "python",
        source: "print(7)",
        stdin: "",
        timeoutMs: 50,
      });
      expect(out).toEqual({ stdout: "7", stderr: "", time_ms: 3, timed_out: false });
    } finally {
      killRunners();
      globalThis.Worker = prior;
    }
    expect(sent.map((m) => m.type)).toEqual(["load", "run"]);
    expect(typeof sent[1]!.indexURL).toBe("string");
    expect(sent[1]!.source).toBe("print(7)");
  });
});
