import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    gemini: { model: "gemini-2.5-flash", keys: [] },
    groq: { llmFallbackModel: "llama-3.3-70b", keys: [] },
    rotation: { baseBackoffMs: 500 },
  },
}));

const { buildGeminiBody, extractJson } = await import("./llmClient");

function parts(body: Record<string, unknown>) {
  return (body.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
}

describe("what Gemini is sent", () => {
  test("a prompt with no images is one text part, as it always was", () => {
    const body = buildGeminiBody({ prompt: "Design a URL shortener." });

    expect(parts(body)).toEqual([{ text: "Design a URL shortener." }]);
  });

  test("an image rides along after the text, inline and base64", () => {
    const body = buildGeminiBody({
      prompt: "Review this board.",
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });

    expect(parts(body)).toEqual([
      { text: "Review this board." },
      { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
    ]);
  });

  test("every image is carried, in the order it was given", () => {
    const body = buildGeminiBody({
      prompt: "Two boards.",
      images: [
        { mimeType: "image/png", data: "one" },
        { mimeType: "image/png", data: "two" },
      ],
    });

    expect(parts(body)).toHaveLength(3);
    expect(parts(body)[2]).toEqual({ inlineData: { mimeType: "image/png", data: "two" } });
  });

  test("the system instruction and the JSON mode still ride on the same body", () => {
    const body = buildGeminiBody({
      system: "JSON only.",
      prompt: "Review this board.",
      json: true,
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });

    expect(body.systemInstruction).toEqual({ parts: [{ text: "JSON only." }] });
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json" });
  });
});

describe("digging the JSON out of a reply", () => {
  test("a fenced block is unwrapped", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
