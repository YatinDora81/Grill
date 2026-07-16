import { test, expect, mock, beforeEach } from "bun:test";
import { z } from "zod";

/**
 * Every structured LLM response in the product — questions, reports, scores —
 * reaches its Zod schema through extractJson, so a parsing regression is not one
 * broken feature but all of them at once. The failure is also expensive twice
 * over: a value that misparses costs a second model round-trip through
 * generateJson's retry, and one that misparses on both tries takes the request
 * down. These pin the shapes models actually emit.
 */

// `server-only` throws outside an RSC, and llmClient reaches env at module scope
// through keyPool's pools. Empty key lists keep constructing them a no-op.
mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({
  config: {
    rotation: { baseBackoffMs: 1 },
    gemini: { keys: [], model: "gemini-test" },
    groq: { keys: [], llmFallbackModel: "groq-test" },
  },
}));

// The real extractJson, captured before llmClient is replaced below. generateJson
// parses through it, so stubbing it would leave the retry tests measuring a mock
// instead of the code that decides whether a retry is needed at all.
const { extractJson } = await import("./llmClient");

const generateText = mock(async (_opts: { prompt: string; json?: boolean }) => "");
mock.module("./llmClient", () => ({ generateText, extractJson }));

const { generateJson } = await import("./llmJson");

// ── extractJson ───────────────────────────────────────────────────

const cases: Array<[name: string, raw: string, expected: string]> = [
  // Gemini in responseMimeType:application/json mode returns exactly this.
  ["passes bare JSON through untouched", '{"a":1}', '{"a":1}'],
  // Groq's json_object mode and every un-hinted model fence their output.
  ["unwraps a ```json fence", '```json\n{"a":1}\n```', '{"a":1}'],
  ["unwraps an unlabelled ``` fence", '```\n{"a":1}\n```', '{"a":1}'],
  // The classic chat preamble/sign-off around an unfenced value.
  ["drops prose on either side of the value", 'Sure! {"a":1} — let me know.', '{"a":1}'],
  // Braces nested inside the value must not be mistaken for its end.
  [
    "keeps nested objects and arrays whole",
    'Here:\n```json\n{"a":{"b":[1,2]},"s":"x"}\n```\nHope that helps!',
    '{"a":{"b":[1,2]},"s":"x"}',
  ],
  // questionGen returns a top-level array. Scanning for `{` alone would start at
  // the first element and drop the opening `[`, so this pins the min() of the
  // two openers rather than a hardcoded brace.
  ["returns a top-level array rather than starting at its first object", '```json\n[{"q":"a"},{"q":"b"}]\n```', '[{"q":"a"},{"q":"b"}]'],
  ["finds a bare array between prose", "Result: [1,2,3] done", "[1,2,3]"],
  // Braces inside string literals are ordinary characters. Trimming to the last
  // `}` in the text happens to be right here only because the value ends there.
  [
    "does not truncate a value whose strings contain braces",
    '{"note":"use {curly} and [sq] here"}',
    '{"note":"use {curly} and [sq] here"}',
  ],
];

test.each(cases)("extractJson %s", (_name, raw, expected) => {
  expect(extractJson(raw)).toBe(expected);
});

test("extractJson stops at the last brace in the text, not the end of the JSON value", () => {
  // DOCUMENTED LIMITATION, not an endorsement: the parser trims to the LAST `}`
  // anywhere in the response, so a sign-off containing one gets swallowed and the
  // result no longer parses. Pinned because generateJson's retry is what covers
  // this in practice, and because a future fix should have to notice this line.
  expect(extractJson('{"a":1}\n\nHope that helps! :}')).toBe('{"a":1}\n\nHope that helps! :}');
  expect(() => JSON.parse(extractJson('{"a":1}\n\nHope that helps! :}'))).toThrow();
});

// ── generateJson ──────────────────────────────────────────────────

const schema = z.object({ score: z.number() });

beforeEach(() => {
  generateText.mockClear();
});

test("accepts the first response and does not spend a second call when it already fits the schema", async () => {
  generateText.mockResolvedValueOnce('```json\n{"score":7}\n```');

  const { value, raw } = await generateJson(schema, { prompt: "rate it" });

  expect(value).toEqual({ score: 7 });
  // raw is the untouched text, fences and all — it is persisted as the safety net.
  expect(raw).toBe('```json\n{"score":7}\n```');
  // A retry on a good response would silently double the token cost and latency
  // of every LLM call in the product.
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("retries once with a valid-JSON reminder when the first response breaks the schema", async () => {
  // Parses as JSON but violates the schema — the case a JSON.parse-only guard
  // would wave through into the rest of the system.
  generateText.mockResolvedValueOnce('{"score":"seven"}');
  generateText.mockResolvedValueOnce('{"score":7}');

  const { value, raw } = await generateJson(schema, { prompt: "rate it" });

  expect(value).toEqual({ score: 7 });
  expect(raw).toBe('{"score":7}');
  expect(generateText).toHaveBeenCalledTimes(2);

  const retry = generateText.mock.calls[1]![0];
  // The reminder has to carry the original prompt, or the retry answers a
  // different question than the one asked.
  expect(retry.prompt).toContain("rate it");
  expect(retry.prompt).toContain("VALID JSON ONLY");
  // json mode must survive the retry; dropping it invites the fenced prose that
  // caused the failure in the first place.
  expect(retry.json).toBe(true);
});

test("throws with the validation error after a failed retry, without a third attempt", async () => {
  generateText.mockResolvedValueOnce("not json at all");
  generateText.mockResolvedValueOnce('{"score":"still not a number"}');

  const err = await generateJson(schema, { prompt: "rate it" }).catch((e: Error) => e);

  expect(err).toBeInstanceOf(Error);
  // The message must name the retry and carry the SECOND failure's detail: this
  // is what a caller sees in logs, and "invalid JSON" alone cannot be triaged.
  expect((err as Error).message).toContain("did not return schema-valid JSON after retry");
  expect((err as Error).message).toContain("number");
  // Exactly one retry. An unbounded loop against a model that cannot satisfy the
  // schema burns the whole key pool on a request that will never succeed.
  expect(generateText).toHaveBeenCalledTimes(2);
});
