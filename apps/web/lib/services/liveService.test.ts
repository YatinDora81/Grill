import { beforeEach, expect, mock, test } from "bun:test";
import type { Session } from "@repo/db";

mock.module("server-only", () => ({}));

const envConfig = { live: { maxConcurrent: 2, maxMinutes: 12 } };
mock.module("@/lib/env", () => ({ config: envConfig }));

let redisKeys: string[] = [];
let redis: {
  set: ReturnType<typeof mock>;
  keys: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
} | null = null;
mock.module("@/lib/redis", () => ({ getRedis: () => redis }));

const opener = {
  turnIndex: 0,
  question: "Why did the ledger drift?",
  questionType: "technical",
  transcript: null,
};
let openerRow: typeof opener | null = opener;

const getTurn = mock(async (_sessionId: string, turnIndex: number) =>
  turnIndex === 0 ? openerRow : null,
);
const recordAnswer = mock(async () => ({}));
const createTurn = mock(async () => ({}));
mock.module("@/lib/db/repo", () => ({ getTurn, recordAnswer, createTurn }));

let scoreThrows = false;
const scoreAnswer = mock(async () => {
  if (scoreThrows) throw new Error("the provider is down");
  return { relevance: 8, correctness: 7, structure: 6, depth: 5, filler: 9 };
});
mock.module("./evaluationService", () => ({ scoreAnswer }));

const { acquireLiveSlot, persistLiveTurns, releaseLiveSlot } = await import("./liveService");

const session = { id: "11111111-1111-4111-8111-111111111111" } as Session;

function makeRedis() {
  return {
    set: mock(async () => "OK"),
    keys: mock(async () => redisKeys),
    del: mock(async () => 1),
  };
}

beforeEach(() => {
  redis = null;
  redisKeys = [];
  openerRow = opener;
  scoreThrows = false;
  envConfig.live.maxConcurrent = 2;
  getTurn.mockClear();
  recordAnswer.mockClear();
  createTurn.mockClear();
  scoreAnswer.mockClear();
});

test("with no redis there is no shared limit, so a seat is never refused", async () => {
  await acquireLiveSlot(session.id);
  await releaseLiveSlot(session.id);
});

test("a seat is taken with nx and a ttl past the session cap", async () => {
  redis = makeRedis();
  redisKeys = ["grill:live:slot:a"];

  await acquireLiveSlot(session.id);

  expect(redis.set).toHaveBeenCalledWith(`grill:live:slot:${session.id}`, "1", {
    nx: true,
    ex: 14 * 60,
  });
  expect(redis.del).not.toHaveBeenCalled();
});

test("one seat too many is handed back and reported as live_busy", async () => {
  redis = makeRedis();
  redisKeys = ["grill:live:slot:a", "grill:live:slot:b", "grill:live:slot:c"];

  await expect(acquireLiveSlot(session.id)).rejects.toMatchObject({
    code: "live_busy",
    status: 503,
  });
  expect(redis.del).toHaveBeenCalledWith(`grill:live:slot:${session.id}`);
});

test("the opener takes the first answer and every later pair becomes a follow-up turn", async () => {
  const written = await persistLiveTurns(session, [
    { question: "Why did the ledger drift?", answer: "Two writers, no lock." },
    { question: "What did you change?", answer: "A single advisory lock." },
  ]);

  expect(written).toBe(2);
  expect(scoreAnswer).toHaveBeenCalledTimes(2);
  expect(scoreAnswer.mock.calls[0]).toEqual([
    "Why did the ledger drift?",
    "technical",
    "Two writers, no lock.",
  ]);
  expect(scoreAnswer.mock.calls[1]).toEqual([
    "What did you change?",
    "followup",
    "A single advisory lock.",
  ]);

  expect(recordAnswer).toHaveBeenCalledTimes(1);
  expect(recordAnswer.mock.calls[0]).toEqual([
    session.id,
    0,
    {
      transcript: "Two writers, no lock.",
      answerScores: { relevance: 8, correctness: 7, structure: 6, depth: 5, filler: 9 },
    },
  ]);

  expect(createTurn).toHaveBeenCalledTimes(1);
  expect(createTurn.mock.calls[0]![0]).toMatchObject({
    sessionId: session.id,
    turnIndex: 1,
    question: "What did you change?",
    questionType: "followup",
    transcript: "A single advisory lock.",
  });
});

test("a question the candidate never answered is dropped from the end", async () => {
  const written = await persistLiveTurns(session, [
    { question: "Why did the ledger drift?", answer: "Two writers, no lock." },
    { question: "What did you change?", answer: "   " },
  ]);

  expect(written).toBe(1);
  expect(createTurn).not.toHaveBeenCalled();
  expect(scoreAnswer).toHaveBeenCalledTimes(1);
});

test("nothing said at all writes nothing", async () => {
  expect(await persistLiveTurns(session, [{ question: "Q1?", answer: "" }])).toBe(0);
  expect(await persistLiveTurns(session, [])).toBe(0);
  expect(recordAnswer).not.toHaveBeenCalled();
});

test("a scoring failure stores the answer unscored rather than scoring it zero", async () => {
  scoreThrows = true;

  const written = await persistLiveTurns(session, [
    { question: "Q1?", answer: "I said this." },
    { question: "Q2?", answer: "And this." },
  ]);

  expect(written).toBe(2);
  expect(recordAnswer.mock.calls[0]![2]).toMatchObject({
    transcript: "I said this.",
    answerScores: null,
  });
  expect(createTurn.mock.calls[0]![0]).toMatchObject({
    transcript: "And this.",
    answerScores: null,
  });
});

test("a session whose opener vanished is a conflict, not a crash", async () => {
  openerRow = null;

  await expect(persistLiveTurns(session, [{ question: "Q1?", answer: "A1." }])).rejects.toMatchObject(
    { code: "unknown_turn", status: 409 },
  );
});
