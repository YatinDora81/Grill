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

const { extractJson, buildGeminiBody, readGroundingSources } = await import("./llmClient");

const generateText = mock(async (_opts: { prompt: string; json?: boolean }) => "");
const generateTextWithSources = mock(
  async (_opts: { prompt: string; json?: boolean; tools?: unknown[] }) => ({
    text: "",
    sources: [] as { uri: string; title: string }[],
  }),
);
mock.module("./llmClient", () => ({
  generateText,
  generateTextWithSources,
  extractJson,
  buildGeminiBody,
  readGroundingSources,
}));

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
  generateTextWithSources.mockClear();
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

test("a tool-less call still goes through generateText, unchanged", async () => {
  generateText.mockResolvedValueOnce('{"score":7}');

  const { value, sources } = await generateJson(schema, { prompt: "rate it" });

  expect(value).toEqual({ score: 7 });
  expect(generateTextWithSources).toHaveBeenCalledTimes(0);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(sources).toEqual([]);
});

test("a call with tools reads its sources back from the grounded path", async () => {
  const found = [{ uri: "https://example.test/a", title: "A" }];
  generateTextWithSources.mockResolvedValueOnce({ text: '{"score":7}', sources: found });

  const { value, sources } = await generateJson(schema, {
    prompt: "rate it",
    tools: [{ google_search: {} }],
  });

  expect(value).toEqual({ score: 7 });
  expect(sources).toEqual(found);
  expect(generateText).toHaveBeenCalledTimes(0);
  expect(generateTextWithSources.mock.calls[0]![0]!.tools).toEqual([{ google_search: {} }]);
});

test("the retry keeps the tools and reports the SECOND call's sources", async () => {
  generateTextWithSources.mockResolvedValueOnce({ text: "not json", sources: [] });
  generateTextWithSources.mockResolvedValueOnce({
    text: '{"score":7}',
    sources: [{ uri: "https://example.test/b", title: "B" }],
  });

  const { value, sources } = await generateJson(schema, {
    prompt: "rate it",
    tools: [{ google_search: {} }],
  });

  expect(value).toEqual({ score: 7 });
  expect(sources).toEqual([{ uri: "https://example.test/b", title: "B" }]);
  const retry = generateTextWithSources.mock.calls[1]![0]!;
  expect(retry.tools).toEqual([{ google_search: {} }]);
  expect(retry.json).toBe(true);
  expect(retry.prompt).toContain("VALID JSON ONLY");
});

test("a tool-less JSON request is byte-identical to the one the app has always sent", () => {
  expect(buildGeminiBody({ prompt: "hi", system: "be terse", json: true, temperature: 0.2 })).toEqual({
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    systemInstruction: { parts: [{ text: "be terse" }] },
  });
});

test("temperature defaults to 0.7 and a missing system prompt adds no key", () => {
  const body = buildGeminiBody({ prompt: "hi" });
  expect(body).toEqual({
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    generationConfig: { temperature: 0.7 },
  });
  expect("systemInstruction" in body).toBe(false);
});

test("tools present ⇒ no responseMimeType, even in json mode", () => {
  const body = buildGeminiBody({ prompt: "hi", json: true, tools: [{ google_search: {} }] });
  expect(body.generationConfig).toEqual({ temperature: 0.7 });
  expect(body.tools).toEqual([{ google_search: {} }]);
});

test("an empty tools array is not a grounded call and does not disturb json mode", () => {
  const body = buildGeminiBody({ prompt: "hi", json: true, tools: [] });
  expect(body.generationConfig).toEqual({
    temperature: 0.7,
    responseMimeType: "application/json",
  });
  expect("tools" in body).toBe(false);
});

const chunk = (uri: unknown, title: unknown) => ({ web: { uri, title } });

test("grounding chunks become {uri,title} pairs, deduped", () => {
  const sources = readGroundingSources({
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [
            chunk("https://example.test/a", "A"),
            chunk("https://example.test/a", "A again"),
            chunk("https://example.test/b", "B"),
          ],
        },
      },
    ],
  });
  expect(sources).toEqual([
    { uri: "https://example.test/a", title: "A" },
    { uri: "https://example.test/b", title: "B" },
  ]);
});

test("a chunk without a usable URI is dropped, and a missing title becomes empty", () => {
  const sources = readGroundingSources({
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [
            chunk(null, "no uri"),
            chunk("", "empty uri"),
            { retrievedContext: { uri: "https://example.test/x" } },
            null,
            chunk("https://example.test/c", undefined),
          ],
        },
      },
    ],
  });
  expect(sources).toEqual([{ uri: "https://example.test/c", title: "" }]);
});

test("an ungrounded response yields an empty list rather than throwing", () => {
  expect(readGroundingSources({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })).toEqual([]);
  expect(readGroundingSources({})).toEqual([]);
  expect(readGroundingSources(null)).toEqual([]);
  expect(readGroundingSources({ candidates: [{ groundingMetadata: { groundingChunks: "nope" } }] })).toEqual([]);
});
