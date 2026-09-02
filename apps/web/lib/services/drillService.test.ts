import { test, expect, mock, beforeEach } from "bun:test";
import type { AnswerScores, QuestionType } from "@repo/types";
import type { DrillCard, Turn } from "@repo/db";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const USER = "11111111-1111-4111-8111-111111111111";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";

const scoreAnswer = mock(async (): Promise<AnswerScores> => scores(4));
const generateJson = mock(async () => ({
  value: {
    improvements: ["Name the outcome."],
    better_line: "We cut the p99 from 900ms to 210ms.",
  },
  raw: "{}",
}));
const sendMail = mock(async () => {});
let mailOn = true;

const repo = {
  rubricMean: mock((value: unknown) => {
    const s = value as AnswerScores | null;
    if (!s || typeof s.relevance !== "number") return null;
    return (s.relevance + s.correctness + s.structure + s.depth + s.filler) / 5;
  }),
  dayKeyIn: mock((date: Date, timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date),
  ),
  getUserById: mock(async () => ({ id: USER, timezone: "Asia/Kolkata" })),
  upsertDrillCard: mock(async () => ({ id: CARD_ID, created: true })),
  addDrillCard: mock(async () => ({ id: CARD_ID })),
  getTurnForUser: mock(async () => ({
    id: TURN_ID,
    question: "Why did you pick Postgres?",
    questionType: "technical" as QuestionType,
  })),
  suspendDrillCard: mock(async () => true),
  listDueDrillCards: mock(async (): Promise<DrillCard[]> => []),
  listAheadDrillCards: mock(async (): Promise<DrillCard[]> => []),
  countDueDrillCards: mock(async () => 0),
  countDrillReviewsSince: mock(async () => 0),
  listReviewDays: mock(async () => new Set<string>()),
  getDrillCard: mock(async (): Promise<DrillCard | null> => card()),
  recordDrillReview: mock(async () => true),
  listDigestCandidates: mock(async () => [] as DigestCandidate[]),
  claimDrillDigest: mock(async () => true),
};

interface DigestCandidate {
  id: string;
  email: string;
  name: string | null;
  timezone: string | null;
  dueCount: number;
  firstDueQuestion: string | null;
}

mock.module("@/lib/db/repo", () => repo);
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));
mock.module("@/lib/services/evaluationService", () => ({ scoreAnswer }));
mock.module("@/lib/mail/mailer", () => ({ sendMail, mailConfigured: () => mailOn }));

const {
  addDrillCardByTurnId,
  answerDrillCard,
  drillStats,
  getDrillQueue,
  reviewDrillCard,
  seedDrillCards,
  sendDrillDigests,
  suspendDrillCard,
} = await import("./drillService");

const NOW = new Date("2026-08-26T09:00:00.000Z");
const DAY_MS = 86_400_000;

function scores(v: number): AnswerScores {
  return { relevance: v, correctness: v, structure: v, depth: v, filler: v };
}

function card(patch: Partial<DrillCard> = {}): DrillCard {
  return {
    id: CARD_ID,
    userId: USER,
    question: "Why did you pick Postgres?",
    questionType: "technical",
    questionHash: "a".repeat(64),
    sourceTurnId: null,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: new Date("2026-08-25T09:00:00.000Z"),
    lastGrade: null,
    bestTranscript: null,
    bestMean: null,
    suspendedAt: null,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    ...patch,
  } as DrillCard;
}

function turn(index: number, mean: number | null, answered = true): Turn {
  return {
    id: `turn-${index}`,
    turnIndex: index,
    question: `Question ${index}?`,
    questionType: "technical",
    transcript: answered ? `Answer ${index}` : null,
    answerScores: mean === null ? null : scores(mean),
  } as unknown as Turn;
}

beforeEach(() => {
  mailOn = true;
  for (const fn of Object.values(repo)) fn.mockClear();
  scoreAnswer.mockClear();
  generateJson.mockClear();
  sendMail.mockClear();
  repo.getUserById.mockResolvedValue({ id: USER, timezone: "Asia/Kolkata" });
  repo.upsertDrillCard.mockResolvedValue({ id: CARD_ID, created: true });
  repo.getDrillCard.mockResolvedValue(card());
  repo.recordDrillReview.mockResolvedValue(true);
  repo.claimDrillDigest.mockResolvedValue(true);
  repo.listDueDrillCards.mockResolvedValue([]);
  repo.listAheadDrillCards.mockResolvedValue([]);
  repo.listDigestCandidates.mockResolvedValue([]);
  repo.listReviewDays.mockResolvedValue(new Set<string>());
  repo.countDueDrillCards.mockResolvedValue(0);
  repo.countDrillReviewsSince.mockResolvedValue(0);
  scoreAnswer.mockResolvedValue(scores(4));
  generateJson.mockResolvedValue({
    value: {
      improvements: ["Name the outcome."],
      better_line: "We cut the p99 from 900ms to 210ms.",
    },
    raw: "{}",
  });
});

test("only badly answered turns become cards", async () => {
  await seedDrillCards(USER, [turn(0, 3), turn(1, 8), turn(2, null), turn(3, 2, false)]);

  const seeded = repo.upsertDrillCard.mock.calls.map((c) => c[0].question);
  expect(seeded).toEqual(["Question 0?"]);
});

test("a board or an editor never becomes a flashcard — the deck is spoken answers only", async () => {
  const design = turn(0, 2);
  design.designReview = { summary: "one primary, no replica" } as unknown as Turn["designReview"];
  const code = turn(1, 2);
  code.codeSubmission = { language: "python" } as unknown as Turn["codeSubmission"];

  await seedDrillCards(USER, [design, code, turn(2, 3)]);

  expect(repo.upsertDrillCard.mock.calls.map((c) => c[0].question)).toEqual(["Question 2?"]);
});

test("the seeding threshold is the line between a partial answer and a solid one", async () => {
  await seedDrillCards(USER, [turn(0, 5.9), turn(1, 6)]);
  expect(repo.upsertDrillCard.mock.calls.map((c) => c[0].question)).toEqual(["Question 0?"]);
});

test("one report can add at most five cards, and keeps the worst answers", async () => {
  const turns = [
    turn(0, 5.5),
    turn(1, 1),
    turn(2, 5),
    turn(3, 2),
    turn(4, 4),
    turn(5, 3),
    turn(6, 5.9),
  ];
  const created = await seedDrillCards(USER, turns);

  expect(repo.upsertDrillCard).toHaveBeenCalledTimes(5);
  expect(created).toBe(5);
  expect(repo.upsertDrillCard.mock.calls.map((c) => c[0].question)).toEqual([
    "Question 1?",
    "Question 3?",
    "Question 5?",
    "Question 4?",
    "Question 2?",
  ]);
});

test("a card seeded twice counts once — the upsert decides, not the caller", async () => {
  repo.upsertDrillCard.mockResolvedValue({ id: CARD_ID, created: false });
  expect(await seedDrillCards(USER, [turn(0, 3), turn(1, 2)])).toBe(0);
});

test("the seed carries the answer that earned the card, so the deck can quote it", async () => {
  await seedDrillCards(USER, [turn(0, 3)]);
  const input = repo.upsertDrillCard.mock.calls[0]?.[0];
  expect(input).toMatchObject({
    userId: USER,
    question: "Question 0?",
    sourceTurnId: "turn-0",
    bestTranscript: "Answer 0",
    bestMean: 3,
  });
});

test("adding from a turn is user-scoped and refuses an unknown turn", async () => {
  await addDrillCardByTurnId(USER, TURN_ID);
  expect(repo.getTurnForUser).toHaveBeenCalledWith(TURN_ID, USER);
  expect(repo.addDrillCard.mock.calls[0]?.[0]).toMatchObject({ sourceTurnId: TURN_ID });

  repo.getTurnForUser.mockResolvedValueOnce(null);
  expect(addDrillCardByTurnId(USER, TURN_ID)).rejects.toMatchObject({ status: 404 });
});

test("suspending passes the owner through so another user's card is untouchable", async () => {
  await suspendDrillCard(USER, CARD_ID);
  expect(repo.suspendDrillCard).toHaveBeenCalledWith(CARD_ID, USER);
});

test("due cards come back as the deck, with the streak and today's count", async () => {
  repo.listDueDrillCards.mockResolvedValue([card(), card({ id: "b", question: "Second?" })]);
  repo.countDueDrillCards.mockResolvedValue(7);
  repo.countDrillReviewsSince.mockResolvedValue(2);
  repo.listReviewDays.mockResolvedValue(new Set(["2026-08-26", "2026-08-25"]));

  const queue = await getDrillQueue(USER, { now: NOW });

  expect(queue.cards.map((c) => c.question)).toEqual(["Why did you pick Postgres?", "Second?"]);
  expect(queue.cards.every((c) => c.ahead === false)).toBe(true);
  expect(queue.due_total).toBe(7);
  expect(queue.reviewed_today).toBe(2);
  expect(queue.streak_days).toBe(2);
  expect(repo.listAheadDrillCards).not.toHaveBeenCalled();
});

test("an empty deck is filled with cards ahead of schedule, labelled as such", async () => {
  repo.listAheadDrillCards.mockResolvedValue([card({ dueAt: new Date("2026-09-01T09:00:00Z") })]);

  const queue = await getDrillQueue(USER, { now: NOW });

  expect(queue.cards).toHaveLength(1);
  expect(queue.cards[0]?.ahead).toBe(true);
  expect(queue.due_total).toBe(0);
});

test("cards already on screen are never handed back", async () => {
  repo.listDueDrillCards.mockResolvedValue([card()]);

  const queue = await getDrillQueue(USER, { now: NOW, exclude: [CARD_ID] });

  expect(queue.cards).toHaveLength(0);
  expect(repo.listAheadDrillCards.mock.calls[0]?.[2]).toEqual([CARD_ID]);
});

test("a user with no timezone is counted in UTC rather than crashing", async () => {
  repo.getUserById.mockResolvedValue({ id: USER, timezone: null });
  await getDrillQueue(USER, { now: NOW });
  expect(repo.listReviewDays.mock.calls[0]?.[1]).toBe("UTC");
});

test("the dashboard stats read the deck without a second user lookup", async () => {
  repo.countDueDrillCards.mockResolvedValue(3);
  repo.listReviewDays.mockResolvedValue(new Set(["2026-08-26"]));

  const stats = await drillStats(USER, "Asia/Kolkata", NOW);

  expect(stats).toEqual({ streak_days: 1, cards_due: 3 });
  expect(repo.getUserById).not.toHaveBeenCalled();
});

test("an answer is scored and coached but nothing is written", async () => {
  repo.getDrillCard.mockResolvedValue(card({ bestTranscript: "Last time's answer." }));
  scoreAnswer.mockResolvedValue(scores(8));

  const res = await answerDrillCard({ userId: USER, cardId: CARD_ID, transcript: "Because MVCC." });

  expect(res.answer_scores).toEqual(scores(8));
  expect(res.suggested_grade).toBe(5);
  expect(res.improvements).toEqual(["Name the outcome."]);
  expect(res.better_line).toBe("We cut the p99 from 900ms to 210ms.");
  expect(res.previous_best).toBe("Last time's answer.");
  expect(repo.recordDrillReview).not.toHaveBeenCalled();
});

test("the suggested grade follows the rubric mean", async () => {
  scoreAnswer.mockResolvedValue(scores(6));
  expect(
    (await answerDrillCard({ userId: USER, cardId: CARD_ID, transcript: "x" })).suggested_grade,
  ).toBe(3);

  scoreAnswer.mockResolvedValue(scores(2));
  expect(
    (await answerDrillCard({ userId: USER, cardId: CARD_ID, transcript: "x" })).suggested_grade,
  ).toBe(1);
});

test("coaching that fails costs two sentences, not the whole answer", async () => {
  generateJson.mockRejectedValue(new Error("all keys exhausted"));

  const res = await answerDrillCard({ userId: USER, cardId: CARD_ID, transcript: "Because MVCC." });

  expect(res.improvements).toEqual([]);
  expect(res.better_line).toBeNull();
  expect(res.answer_scores).toBeDefined();
});

test("another user's card is not found", async () => {
  repo.getDrillCard.mockResolvedValue(null);
  expect(answerDrillCard({ userId: USER, cardId: CARD_ID, transcript: "x" })).rejects.toMatchObject(
    { status: 404, code: "unknown_card" },
  );
});

test("grading moves the card by SM-2 and answers with the new schedule", async () => {
  repo.listReviewDays.mockResolvedValue(new Set(["2026-08-26", "2026-08-25", "2026-08-24"]));

  const res = await reviewDrillCard({
    userId: USER,
    cardId: CARD_ID,
    grade: 5,
    transcript: "Because MVCC.",
    answerScores: scores(8),
    now: NOW,
  });

  const written = repo.recordDrillReview.mock.calls[0]?.[0];
  expect(written).toMatchObject({ cardId: CARD_ID, userId: USER, grade: 5 });
  expect(written?.schedule.intervalDays).toBe(1);
  expect(written?.schedule.ease).toBe(2.6);
  expect(written?.attempt).toEqual({ transcript: "Because MVCC.", mean: 8 });

  expect(res.interval_days).toBe(1);
  expect(res.due_at).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());
  expect(res.streak_days).toBe(3);
});

test("a blanked card starts over without losing its ease history", async () => {
  repo.getDrillCard.mockResolvedValue(card({ ease: 2.1, intervalDays: 21, repetitions: 4 }));

  await reviewDrillCard({ userId: USER, cardId: CARD_ID, grade: 1, now: NOW });

  const written = repo.recordDrillReview.mock.calls[0]?.[0];
  expect(written?.schedule).toMatchObject({ repetitions: 0, intervalDays: 1, ease: 1.56 });
});

test("an ungraded or unscored attempt never overwrites the stored best", async () => {
  await reviewDrillCard({ userId: USER, cardId: CARD_ID, grade: 3, transcript: "  ", now: NOW });
  expect(repo.recordDrillReview.mock.calls[0]?.[0].attempt).toBeNull();

  repo.recordDrillReview.mockClear();
  await reviewDrillCard({ userId: USER, cardId: CARD_ID, grade: 3, transcript: "said", now: NOW });
  expect(repo.recordDrillReview.mock.calls[0]?.[0].attempt).toBeNull();
});

test("a card that vanished mid-review is a 404, not a silent success", async () => {
  repo.recordDrillReview.mockResolvedValue(false);
  expect(
    reviewDrillCard({ userId: USER, cardId: CARD_ID, grade: 5, now: NOW }),
  ).rejects.toMatchObject({ status: 404 });
});

const candidate = (patch: Partial<DigestCandidate> = {}): DigestCandidate => ({
  id: USER,
  email: "sam@example.test",
  name: "Sam",
  timezone: "Asia/Kolkata",
  dueCount: 3,
  firstDueQuestion: "Why did you pick Postgres?",
  ...patch,
});

test("no SMTP means no digest and no queries — never a failed sweep", async () => {
  mailOn = false;
  expect(await sendDrillDigests(NOW)).toBe(0);
  expect(repo.listDigestCandidates).not.toHaveBeenCalled();
});

test("each candidate is claimed before the mail leaves, and only once", async () => {
  const order: string[] = [];
  repo.claimDrillDigest.mockImplementation(async () => {
    order.push("claim");
    return true;
  });
  sendMail.mockImplementation(async () => {
    order.push("send");
  });
  repo.listDigestCandidates.mockResolvedValue([candidate()]);

  expect(await sendDrillDigests(NOW)).toBe(1);
  expect(order).toEqual(["claim", "send"]);

  const cutoff = repo.claimDrillDigest.mock.calls[0]?.[1] as Date;
  expect(NOW.getTime() - cutoff.getTime()).toBe(7 * DAY_MS);
});

test("a user another sweep already claimed is skipped without a send", async () => {
  repo.listDigestCandidates.mockResolvedValue([candidate()]);
  repo.claimDrillDigest.mockResolvedValue(false);

  expect(await sendDrillDigests(NOW)).toBe(0);
  expect(sendMail).not.toHaveBeenCalled();
});

test("the mail carries the count, the streak and the first question verbatim", async () => {
  repo.listDigestCandidates.mockResolvedValue([candidate()]);
  repo.listReviewDays.mockResolvedValue(new Set(["2026-08-25", "2026-08-24"]));

  await sendDrillDigests(NOW);

  const msg = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; text: string };
  expect(msg.to).toBe("sam@example.test");
  expect(msg.subject).toContain("3 questions due");
  expect(msg.text).toContain("Why did you pick Postgres?");
  expect(msg.text).toContain("You are 2 days deep");
});

test("one address that blows up does not take the rest of the sweep with it", async () => {
  repo.listDigestCandidates.mockResolvedValue([
    candidate({ id: "a", email: "a@example.test" }),
    candidate({ id: "b", email: "b@example.test" }),
  ]);
  sendMail.mockImplementationOnce(async () => {
    throw new Error("550 mailbox unavailable");
  });

  expect(await sendDrillDigests(NOW)).toBe(1);
  expect(sendMail).toHaveBeenCalledTimes(2);
});
