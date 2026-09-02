import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 1_000 },
    live: { maxConcurrent: 2, maxMinutes: 12 },
    gemini: { keys: [] },
    groq: { keys: [] },
    rotation: { baseBackoffMs: 1 },
  },
}));

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

let sessionStatus = "in_progress";
let live = true;
let openerTranscript: string | null = null;

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    id === SESSION_ID && userId === "user-1"
      ? { id: SESSION_ID, userId: "user-1", status: sessionStatus }
      : null,
  getTurn: async (_id: string, turnIndex: number) =>
    turnIndex === 0
      ? { turnIndex: 0, question: "Why did the ledger drift?", transcript: openerTranscript }
      : null,
}));

mock.module("@/lib/services/sessionContext", () => ({
  toSessionContext: () => ({
    sourceType: "resume",
    sourceText: "",
    role: null,
    config: { num_questions: 6, difficulty: "hard", sources: ["resume"], mode: null, live },
  }),
}));

const persistLiveTurns = mock(async () => 2);
const releaseLiveSlot = mock(async () => {});
mock.module("@/lib/services/liveService", () => ({ persistLiveTurns, releaseLiveSlot }));

const { POST } = await import("./route");

const TURNS = [
  { question: "Why did the ledger drift?", answer: "Two writers, no lock." },
  { question: "What did you change?", answer: "A single advisory lock." },
];

function post(body: unknown = { session_id: SESSION_ID, turns: TURNS }) {
  return POST(
    new Request("https://example.test/api/interview/live/complete", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  sessionStatus = "in_progress";
  live = true;
  openerTranscript = null;
  persistLiveTurns.mockClear();
  releaseLiveSlot.mockClear();
});

test("the pairs are written once and the seat is handed back", async () => {
  const res = await post();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ session_id: SESSION_ID, turns: 2 });
  expect(persistLiveTurns).toHaveBeenCalledTimes(1);
  expect(persistLiveTurns.mock.calls[0]![1]).toEqual(TURNS);
  expect(releaseLiveSlot).toHaveBeenCalledWith(SESSION_ID);
});

test("a second save is refused because turn 0 already has a transcript", async () => {
  openerTranscript = "Two writers, no lock.";

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "already_completed" } });
  expect(persistLiveTurns).not.toHaveBeenCalled();
});

test("a session that is not live cannot be completed this way", async () => {
  live = false;

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "not_live" } });
  expect(persistLiveTurns).not.toHaveBeenCalled();
});

test("an interview that already ended is refused", async () => {
  sessionStatus = "generating_report";

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "session_not_active" } });
});

test("more pairs than a live session can hold is a validation error", async () => {
  const res = await post({
    session_id: SESSION_ID,
    turns: Array.from({ length: 41 }, (_, i) => ({ question: `Q${i}`, answer: "A" })),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "validation_error" } });
  expect(persistLiveTurns).not.toHaveBeenCalled();
});

test("an empty log is accepted so a session that said nothing can still be closed", async () => {
  persistLiveTurns.mockImplementationOnce(async () => 0);

  const res = await post({ session_id: SESSION_ID, turns: [] });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ session_id: SESSION_ID, turns: 0 });
});
