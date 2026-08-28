import { test, expect, mock, beforeEach } from "bun:test";
import { z } from "zod";

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

const cases: Array<[name: string, raw: string, expected: string]> = [
  ["passes bare JSON through untouched", '{"a":1}', '{"a":1}'],
  ["unwraps a ```json fence", '```json\n{"a":1}\n```', '{"a":1}'],
  ["unwraps an unlabelled ``` fence", '```\n{"a":1}\n```', '{"a":1}'],
  ["drops prose on either side of the value", 'Sure! {"a":1} — let me know.', '{"a":1}'],
  [
    "keeps nested objects and arrays whole",
    'Here:\n```json\n{"a":{"b":[1,2]},"s":"x"}\n```\nHope that helps!',
    '{"a":{"b":[1,2]},"s":"x"}',
  ],
  ["returns a top-level array rather than starting at its first object", '```json\n[{"q":"a"},{"q":"b"}]\n```', '[{"q":"a"},{"q":"b"}]'],
  ["finds a bare array between prose", "Result: [1,2,3] done", "[1,2,3]"],
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
  expect(extractJson('{"a":1}\n\nHope that helps! :}')).toBe('{"a":1}\n\nHope that helps! :}');
  expect(() => JSON.parse(extractJson('{"a":1}\n\nHope that helps! :}'))).toThrow();
});

const schema = z.object({ score: z.number() });

beforeEach(() => {
  generateText.mockClear();
});

test("accepts the first response and does not spend a second call when it already fits the schema", async () => {
  generateText.mockResolvedValueOnce('```json\n{"score":7}\n```');

  const { value, raw } = await generateJson(schema, { prompt: "rate it" });

  expect(value).toEqual({ score: 7 });
  expect(raw).toBe('```json\n{"score":7}\n```');
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("retries once with a valid-JSON reminder when the first response breaks the schema", async () => {
  generateText.mockResolvedValueOnce('{"score":"seven"}');
  generateText.mockResolvedValueOnce('{"score":7}');

  const { value, raw } = await generateJson(schema, { prompt: "rate it" });

  expect(value).toEqual({ score: 7 });
  expect(raw).toBe('{"score":7}');
  expect(generateText).toHaveBeenCalledTimes(2);

  const retry = generateText.mock.calls[1]![0];
  expect(retry.prompt).toContain("rate it");
  expect(retry.prompt).toContain("VALID JSON ONLY");
  expect(retry.json).toBe(true);
});

test("throws with the validation error after a failed retry, without a third attempt", async () => {
  generateText.mockResolvedValueOnce("not json at all");
  generateText.mockResolvedValueOnce('{"score":"still not a number"}');

  const err = await generateJson(schema, { prompt: "rate it" }).catch((e: Error) => e);

  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("did not return schema-valid JSON after retry");
  expect((err as Error).message).toContain("number");
  expect(generateText).toHaveBeenCalledTimes(2);
});
