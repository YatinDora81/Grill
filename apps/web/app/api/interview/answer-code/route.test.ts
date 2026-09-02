import { beforeEach, expect, mock, test } from "bun:test";
import type { AnswerInput } from "@/lib/services/answerService";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 1_000 },
    audio: { maxBytes: 20 * 1_024 * 1_024 },
    gemini: { keys: [] },
    groq: { keys: [] },
    rotation: { baseBackoffMs: 500 },
  },
}));

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const session = { id: SESSION_ID, userId: "user-1", status: "in_progress" };

const PROBLEM = {
  kind: "coding",
  title: "Merge the ledgers",
  prompt_markdown:
    "Read two sorted ledgers from stdin, one number per line, and print the merged ledger.",
  examples: [{ input: "1\n2", output: "1\n2" }],
  hidden_tests: [
    { input: "", output: "" },
    { input: "1", output: "1" },
  ],
  starter: { python: "import sys", javascript: "const line = readLine();" },
  complexity_target: "O(n) time",
};

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    id === SESSION_ID && userId === "user-1" ? session : null,
  getTurn: async (id: string, turnIndex: number) => {
    if (id !== SESSION_ID) return null;
    if (turnIndex === 0) return { turnIndex: 0, transcript: null, questionPayload: PROBLEM };
    if (turnIndex === 1) return { turnIndex: 1, transcript: null, questionPayload: null };
    return null;
  },
}));

mock.module("@/lib/storage/objectStore", () => ({
  audioKey: (id: string, turnIndex: number, ext: string) => `audio/${id}/${turnIndex}.${ext}`,
  putAudio: async () => {},
}));

const transcribe = mock(async () => ({
  text: "I merge with two pointers.",
  words: [{ word: "I", start: 0.5, end: 0.8 }],
  confidence: -0.2,
}));
mock.module("@/lib/clients/sttClient", () => ({ transcribe }));

const generateJson = mock(async () => ({
  value: { relevance: 8, correctness: 6, structure: 7, depth: 6, filler: 9 },
  raw: "",
  sources: [],
}));
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const processAnswer = mock(async () => ({
  turn_index: 0,
  transcript: "[python] 1/2 tests passed",
  answer_scores: { relevance: 8, correctness: 6, structure: 7, depth: 6, filler: 9 },
  next_question: "Why is that O(n log n)?",
  next_question_type: "followup",
  next_payload: null,
  done: false,
}));
mock.module("@/lib/services/answerService", () => ({ processAnswer }));

const { POST } = await import("./route");

const KEYSTROKES = {
  first_edit_ms: 4_200,
  edits: 90,
  chars_added: 640,
  chars_deleted: 80,
  longest_idle_ms: 31_000,
  runs: 3,
  run_timeline: [{ t_ms: 60_000, passed: 1, total: 2 }],
  submitted_at_ms: 20_000,
};

const PAYLOAD = {
  language: "python",
  source: "print(1)",
  results: [
    {
      index: 0,
      kind: "example",
      passed: true,
      stdout: "1\n2",
      stderr: "",
      expected: "1\n2",
      time_ms: 12,
      timed_out: false,
    },
    {
      index: 0,
      kind: "hidden",
      passed: false,
      stdout: "",
      stderr: "IndexError",
      expected: "1",
      time_ms: 9,
      timed_out: false,
    },
  ],
  keystrokes: KEYSTROKES,
};

function post(opts: { turnIndex?: string; payload?: string; audio?: File } = {}) {
  const form = new FormData();
  form.append("session_id", SESSION_ID);
  form.append("turn_index", opts.turnIndex ?? "0");
  form.append("payload", opts.payload ?? JSON.stringify(PAYLOAD));
  if (opts.audio) form.append("audio", opts.audio);
  return POST(
    new Request("https://example.test/api/interview/answer-code", { method: "POST", body: form }),
  );
}

const lastInput = () => processAnswer.mock.calls[0]![0] as unknown as AnswerInput;

beforeEach(() => {
  processAnswer.mockClear();
  transcribe.mockClear();
  generateJson.mockClear();
});

test("a submission with no mic is graded on the tests alone and never transcribed", async () => {
  const res = await post();

  expect(res.status).toBe(200);
  expect(transcribe).not.toHaveBeenCalled();

  const input = lastInput();
  expect(input.answerScores).toEqual({
    relevance: 8,
    correctness: 6,
    structure: 7,
    depth: 6,
    filler: 9,
  });
  expect(input.codeSubmission).toMatchObject({ language: "python", passed: 1, total: 2 });
  expect(input.codeSubmission?.think_aloud_pct).toBeNull();
  expect(input.audioKey).toBeNull();
  expect(input.transcript).toContain("[python] 1/2 tests passed");
  expect(input.transcript).toContain("Spoken while coding: (nothing)");
});

test("a clip that came with the code is stored, transcribed and measured", async () => {
  const audio = new File([new Uint8Array([1, 2, 3])], "turn_0.webm", { type: "audio/webm" });

  const res = await post({ audio });

  expect(res.status).toBe(200);
  expect(transcribe).toHaveBeenCalledTimes(1);

  const input = lastInput();
  expect(input.audioKey).toBe(`audio/${SESSION_ID}/0.webm`);
  expect(input.transcriptConfidence).toBe(-0.2);
  expect(input.transcript).toContain("Spoken while coding: I merge with two pointers.");
  expect(input.codeSubmission?.think_aloud_pct).not.toBeNull();
});

test("a spoken turn cannot take a code submission", async () => {
  const res = await post({ turnIndex: "1" });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "not_a_coding_turn" } });
  expect(processAnswer).not.toHaveBeenCalled();
});

test("a payload that is not JSON is refused before anything is graded", async () => {
  const res = await post({ payload: "{not json" });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "bad_payload" } });
  expect(generateJson).not.toHaveBeenCalled();
  expect(processAnswer).not.toHaveBeenCalled();
});

test("a payload that is JSON but not a submission is a validation error", async () => {
  const res = await post({ payload: JSON.stringify({ language: "ruby" }) });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "validation_error" } });
  expect(processAnswer).not.toHaveBeenCalled();
});
