import { test, expect, mock, beforeEach } from "bun:test";
import type { AnswerInput } from "@/lib/services/answerService";
import { MAX_ANSWER_OFFSET_MS } from "@/lib/live/turnTaking";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const session = { id: SESSION_ID, userId: "user-1", status: "in_progress" };

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    id === SESSION_ID && userId === "user-1" ? session : null,
  getTurn: async (id: string, turnIndex: number) =>
    id === SESSION_ID && turnIndex === 0
      ? { turnIndex: 0, question: "Why did you leave?", transcript: null }
      : null,
}));

mock.module("@/lib/storage/objectStore", () => ({
  audioKey: (id: string, turnIndex: number, ext: string) => `audio/${id}/${turnIndex}.${ext}`,
  putAudio: async () => {},
}));

mock.module("@/lib/clients/sttClient", () => ({
  transcribe: async () => ({
    text: "We sharded by tenant.",
    words: [{ word: "We", start: 0.8, end: 1.1 }],
  }),
}));

const processAnswer = mock(async () => ({
  turn_index: 0,
  transcript: "We sharded by tenant.",
  answer_scores: { relevance: 8, correctness: 7, structure: 6, depth: 7, filler: 9 },
  next_question: "And the sequence?",
  next_question_type: "followup",
  done: false,
}));
mock.module("@/lib/services/answerService", () => ({ processAnswer }));

const { POST } = await import("./route");

function post(fields: Record<string, string>) {
  const form = new FormData();
  form.append("session_id", SESSION_ID);
  form.append("turn_index", "0");
  form.append(
    "audio",
    new File([new Uint8Array([1, 2, 3])], "turn_0.webm", { type: "audio/webm" }),
  );
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(
    new Request("https://example.test/api/interview/answer", { method: "POST", body: form }),
  );
}

const lastInput = () => processAnswer.mock.calls[0]![0] as unknown as AnswerInput;

beforeEach(() => {
  processAnswer.mockClear();
});

test("the measured mic offset and the cut-off second reach the service as numbers", async () => {
  const res = await post({ answer_offset_ms: "250", interrupted_at_s: "76" });

  expect(res.status).toBe(200);
  expect(lastInput()).toMatchObject({ answerOffsetMs: 250, interruptedAtS: 76 });
});

test("a room that sent neither field hands the service nulls, never undefined", async () => {
  const res = await post({});

  expect(res.status).toBe(200);
  const input = lastInput();
  expect(input.answerOffsetMs).toBeNull();
  expect(input.interruptedAtS).toBeNull();
});

test("empty strings, which is what a form sends for an absent field, read as absent", async () => {
  await post({ answer_offset_ms: "", interrupted_at_s: "" });

  const input = lastInput();
  expect(input.answerOffsetMs).toBeNull();
  expect(input.interruptedAtS).toBeNull();
});

test("an offset the clock could not have produced is a 400, not a stored number", async () => {
  const res = await post({ answer_offset_ms: "-1" });

  expect(res.status).toBe(400);
  expect(processAnswer).not.toHaveBeenCalled();
});

test("the bound the room checks before sending is the bound the route enforces", async () => {
  expect((await post({ answer_offset_ms: String(MAX_ANSWER_OFFSET_MS) })).status).toBe(200);

  processAnswer.mockClear();
  const res = await post({ answer_offset_ms: String(MAX_ANSWER_OFFSET_MS + 1) });

  expect(res.status).toBe(400);
  expect(processAnswer).not.toHaveBeenCalled();
});
