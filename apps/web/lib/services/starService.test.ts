import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { StarLabel, TranscriptWord } from "@repo/types";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

interface StarReply {
  labels: StarLabel[];
  missing: ("S" | "T" | "A" | "R")[];
  note: string;
}

let prompts: string[] = [];
let replies: Map<string, StarReply | Error> = new Map();

function reply(prompt: string): StarReply | Error {
  for (const [needle, value] of replies) {
    if (prompt.includes(needle)) return value;
  }
  return { labels: ["other"], missing: [], note: "Nothing to say." };
}

mock.module("@/lib/clients/llmJson", () => ({
  generateJson: mock(async (_schema: unknown, opts: { system?: string; prompt: string }) => {
    prompts.push(opts.prompt);
    const value = reply(opts.prompt);
    if (value instanceof Error) throw value;
    return { value, raw: JSON.stringify(value) };
  }),
}));

const { computeStarBreakdown, sentenceSpans, sentenceSpansFromText, starShares } =
  await import("@/lib/services/starService");

type StarTurn = Parameters<typeof computeStarBreakdown>[0][number];

function timed(...spans: [word: string, start: number, end: number][]): TranscriptWord[] {
  return spans.map(([word, start, end]) => ({ word, start, end }));
}

function turn(over: Partial<StarTurn> & { turnIndex: number }): StarTurn {
  return {
    question: `Question ${over.turnIndex}`,
    questionType: "cultural",
    transcript: "I owned it. I shipped it.",
    transcriptWords: null,
    ...over,
  };
}

beforeEach(() => {
  prompts = [];
  replies = new Map();
});

describe("sentenceSpans", () => {
  test("a terminal stop on the token ends the sentence there", () => {
    const spans = sentenceSpans(
      timed(["We", 0, 0.3], ["shipped", 0.3, 0.8], ["it.", 0.8, 1.2], ["Then", 1.4, 1.7]),
    );

    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ text: "We shipped it.", start: 0, end: 1.2 });
    expect(spans[1]).toEqual({ text: "Then", start: 1.4, end: 1.7 });
  });

  test("punctuation wearing a quote or bracket still ends the sentence", () => {
    const spans = sentenceSpans(timed(['"go."', 0, 0.4], ["Next", 0.5, 0.9]));
    expect(spans.map((s) => s.text)).toEqual(['"go."', "Next"]);
  });

  test("a minute of unpunctuated speech is chunked every 35 words, not left whole", () => {
    const words = timed(
      ...Array.from({ length: 80 }, (_, i): [string, number, number] => [`w${i}`, i, i + 1]),
    );
    const spans = sentenceSpans(words);

    expect(spans).toHaveLength(3);
    expect(spans[0]!.text.split(" ")).toHaveLength(35);
    expect(spans[1]!.text.split(" ")).toHaveLength(35);
    expect(spans[2]!.text.split(" ")).toHaveLength(10);
  });

  test("a trailing sentence with no full stop is still flushed", () => {
    const spans = sentenceSpans(timed(["Done.", 0, 1], ["and", 1, 2], ["then", 2, 3]));
    expect(spans.map((s) => s.text)).toEqual(["Done.", "and then"]);
    expect(spans[1]!.end).toBe(3);
  });

  test("no words means no sentences, not one empty one", () => {
    expect(sentenceSpans([])).toEqual([]);
  });

  test("a run of blank tokens produces no segment to hover over", () => {
    expect(sentenceSpans(timed([" ", 0, 0.2], ["", 0.2, 0.4]))).toEqual([]);
  });
});

describe("sentenceSpansFromText", () => {
  test("typed answers are measured in word indices, one unit per word", () => {
    const spans = sentenceSpansFromText("I owned the migration. We shipped late.");

    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ text: "I owned the migration.", start: 0, end: 4 });
    expect(spans[1]).toEqual({ text: "We shipped late.", start: 4, end: 7 });
  });

  test("whitespace-only text has nothing to split", () => {
    expect(sentenceSpansFromText("   \n  ")).toEqual([]);
  });
});

describe("starShares", () => {
  const spans = [
    { text: "a", start: 0, end: 6 },
    { text: "b", start: 6, end: 7 },
    { text: "c", start: 7, end: 9 },
    { text: "d", start: 9, end: 10 },
  ];

  test("the four shares plus other always add up to 100", () => {
    const { share } = starShares(spans, ["S", "T", "A", "R"]);
    const sum = share.S + share.T + share.A + share.R + share.other;

    expect(sum).toBeCloseTo(100, 5);
    expect(share.S).toBe(60);
    expect(share.other).toBe(0);
  });

  test("thirds still add up to 100 rather than 99.9", () => {
    const thirds = [
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
      { text: "c", start: 2, end: 3 },
    ];
    const { share } = starShares(thirds, ["S", "A", "R"]);

    expect(share.S + share.T + share.A + share.R + share.other).toBeCloseTo(100, 5);
  });

  test("fewer labels than sentences pads with other instead of dropping the tail", () => {
    const { segments, share } = starShares(spans, ["S", "T"]);

    expect(segments.map((s) => s.label)).toEqual(["S", "T", "other", "other"]);
    expect(share.other).toBe(30);
  });

  test("segments keep the order they were said, so the bar reads as a timeline", () => {
    const { segments } = starShares(spans, ["R", "A", "T", "S"]);
    expect(segments.map((s) => [s.label, s.start, s.end])).toEqual([
      ["R", 0, 6],
      ["A", 6, 7],
      ["T", 7, 9],
      ["S", 9, 10],
    ]);
  });

  test("a clip whose words all share one timestamp falls back to one unit a sentence", () => {
    const flat = [
      { text: "a", start: 4, end: 4 },
      { text: "b", start: 4, end: 4 },
    ];
    const { share } = starShares(flat, ["S", "R"]);

    expect(share.S).toBe(50);
    expect(share.R).toBe(50);
  });

  test("no sentences means no shares, and no NaN", () => {
    const { segments, share } = starShares([], []);
    expect(segments).toEqual([]);
    expect(share).toEqual({ S: 0, T: 0, A: 0, R: 0, other: 0 });
    expect(Number.isNaN(share.S)).toBe(false);
  });
});

describe("computeStarBreakdown", () => {
  test("only behavioral answers are labelled — technical turns cost no call", async () => {
    replies.set("Question 1", { labels: ["S", "R"], missing: [], note: "Balanced." });

    const out = await computeStarBreakdown([
      turn({ turnIndex: 0, questionType: "technical" }),
      turn({ turnIndex: 1, questionType: "cultural" }),
      turn({ turnIndex: 2, questionType: "followup" }),
    ]);

    expect(out.map((b) => b.turn_index)).toEqual([1]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Question 1");
  });

  test("legacy `behavioral` turns are labelled too — it always meant cultural", async () => {
    const out = await computeStarBreakdown([turn({ turnIndex: 0, questionType: "behavioral" })]);
    expect(out).toHaveLength(1);
  });

  test("an unanswered behavioral turn is skipped rather than sent empty", async () => {
    const out = await computeStarBreakdown([
      turn({ turnIndex: 0, transcript: null }),
      turn({ turnIndex: 1, transcript: "   " }),
    ]);

    expect(out).toEqual([]);
    expect(prompts).toEqual([]);
  });

  test("one failing turn costs its own bar, never the report", async () => {
    const warned: unknown[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => warned.push(args[0]);

    replies.set("Question 0", new Error("provider down"));
    replies.set("Question 1", { labels: ["S", "A"], missing: [], note: "Fine." });

    try {
      const out = await computeStarBreakdown([turn({ turnIndex: 0 }), turn({ turnIndex: 1 })]);
      expect(out.map((b) => b.turn_index)).toEqual([1]);
      expect(warned.some((w) => String(w).includes("[starService] turn 0"))).toBe(true);
    } finally {
      console.warn = realWarn;
    }
  });

  test("timed words give a time basis and seconds on the segments", async () => {
    replies.set("Question 0", { labels: ["S", "R"], missing: [], note: "Fine." });

    const out = await computeStarBreakdown([
      turn({
        turnIndex: 0,
        transcript: "I owned it. I shipped it.",
        transcriptWords: timed(
          ["I", 0, 0.4],
          ["owned", 0.4, 0.9],
          ["it.", 0.9, 1.5],
          ["I", 2, 2.3],
          ["shipped", 2.3, 2.9],
          ["it.", 2.9, 3.5],
        ),
      }),
    ]);

    expect(out[0]!.basis).toBe("time");
    expect(out[0]!.segments[0]).toEqual({ label: "S", start: 0, end: 1.5, text: "I owned it." });
  });

  test("a typed answer is measured in words, and says so", async () => {
    replies.set("Question 0", { labels: ["S", "R"], missing: [], note: "Fine." });

    const out = await computeStarBreakdown([
      turn({ turnIndex: 0, transcript: "I owned it. I shipped it.", transcriptWords: null }),
    ]);

    expect(out[0]!.basis).toBe("words");
    expect(out[0]!.segments[0]!.start).toBe(0);
    expect(out[0]!.segments[1]!.end).toBe(6);
  });

  test("an unreadable transcript_words column falls back to words, it does not throw", async () => {
    const out = await computeStarBreakdown([
      turn({ turnIndex: 0, transcriptWords: [{ word: "I", start: "nope" }] }),
    ]);

    expect(out[0]!.basis).toBe("words");
  });

  test("missing parts are read off the labels, not taken from the model's claim", async () => {
    replies.set("Question 0", { labels: ["S", "A"], missing: ["A"], note: "No outcome." });

    const out = await computeStarBreakdown([turn({ turnIndex: 0 })]);
    expect(out[0]!.missing).toEqual(["T", "R"]);
  });

  test("labels are padded when the model returns fewer than it was asked for", async () => {
    replies.set("Question 0", { labels: ["S"], missing: [], note: "Short reply." });

    const out = await computeStarBreakdown([turn({ turnIndex: 0 })]);
    expect(out[0]!.segments.map((s) => s.label)).toEqual(["S", "other"]);
  });

  test("results come back in turn order however the workers finished", async () => {
    const out = await computeStarBreakdown([
      turn({ turnIndex: 4 }),
      turn({ turnIndex: 1, questionType: "technical" }),
      turn({ turnIndex: 7 }),
    ]);

    expect(out.map((b) => b.turn_index)).toEqual([4, 7]);
  });

  test("nothing behavioral means no calls and an empty array", async () => {
    const out = await computeStarBreakdown([turn({ turnIndex: 0, questionType: "technical" })]);
    expect(out).toEqual([]);
    expect(prompts).toEqual([]);
  });

  test("an enormous answer is truncated to the labels the schema will accept", async () => {
    const transcript = Array.from({ length: 401 }, (_, i) => `s${i}.`).join(" ");
    const out = await computeStarBreakdown([turn({ turnIndex: 0, transcript })]);

    expect(out).toHaveLength(1);
    expect(prompts[0]).toContain("exactly 400 entries");
    expect(prompts[0]).not.toContain("401. ");
  });
});
