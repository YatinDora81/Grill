import { test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

interface Row {
  id: string;
  userId: string;
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

const sessions = new Map<string, Row>([
  [SESSION_ID, { id: SESSION_ID, userId: "user-1" }],
  [OTHER_SESSION_ID, { id: OTHER_SESSION_ID, userId: "someone-else" }],
]);

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) => {
    const row = sessions.get(id);
    return row && row.userId === userId ? row : null;
  },
  getTurn: async (id: string, turnIndex: number) =>
    id === SESSION_ID && turnIndex === 0
      ? { turnIndex: 0, question: "Why did you leave?" }
      : null,
}));

let outcome: unknown = { url: "https://r2.test/clip.wav", provider: "orpheus", cached: true };
const questionAudio = mock(async () => outcome);
mock.module("@/lib/services/voiceService", () => ({ questionAudio }));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("https://example.test/api/interview/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  questionAudio.mockClear();
  outcome = { url: "https://r2.test/clip.wav", provider: "orpheus", cached: true };
});

test("returns the clip for a turn of the caller's own interview", async () => {
  const res = await post({ session_id: SESSION_ID, turn_index: 0 });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: true,
  });
});

test("answers 200 when the voice service chose the browser instead", async () => {
  outcome = { url: null, provider: "browser", reason: "budget" };

  const res = await post({ session_id: SESSION_ID, turn_index: 0 });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ url: null, provider: "browser", reason: "budget" });
});

test("forwards the remaining synthesis budget verbatim, including zero", async () => {
  outcome = { url: null, provider: "browser", reason: "budget", budget_remaining: 0 };

  const res = await post({ session_id: SESSION_ID, turn_index: 0 });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    url: null,
    provider: "browser",
    reason: "budget",
    budget_remaining: 0,
  });
});

test("omits the budget entirely when the service reports none", async () => {
  outcome = { url: "https://r2.test/clip.wav", provider: "orpheus", cached: true };

  const res = await post({ session_id: SESSION_ID, turn_index: 0 });

  expect(await res.json()).not.toHaveProperty("budget_remaining");
});

test("rejects a turn index the interview does not have", async () => {
  const res = await post({ session_id: SESSION_ID, turn_index: 7 });

  expect(res.status).toBe(400);
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: "unknown_turn" },
  });
  expect(questionAudio).not.toHaveBeenCalled();
});

test("cannot read a question out of somebody else's interview", async () => {
  const res = await post({ session_id: OTHER_SESSION_ID, turn_index: 0 });

  expect(res.status).toBe(404);
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: "unknown_session" },
  });
  expect(questionAudio).not.toHaveBeenCalled();
});

test("rejects a body that names no turn at all", async () => {
  const res = await post({ session_id: SESSION_ID });

  expect(res.status).toBe(400);
  expect((await res.json()) as { error: { code: string } }).toMatchObject({
    error: { code: "validation_error" },
  });
  expect(questionAudio).not.toHaveBeenCalled();
});
