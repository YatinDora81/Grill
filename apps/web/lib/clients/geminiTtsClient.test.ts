import { test, expect, mock, beforeEach } from "bun:test";
import { AllKeysExhausted } from "@/lib/errors";

mock.module("server-only", () => ({}));

const envConfig = {
  gemini: {
    keys: [
      { label: "one", key: "gem-key-one" },
      { label: "two", key: "gem-key-two" },
    ],
  },
  groq: { keys: [] as { label: string; key: string }[] },
  tts: { geminiModel: "gemini-2.5-flash-preview-tts" },
  rotation: { baseBackoffMs: 0, providerTimeoutMs: 5_000 },
};
mock.module("@/lib/env", () => ({ config: envConfig }));

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

let sent: Sent[] = [];
let replies: (() => Response)[] = [];

const fetchWithTimeout = mock(async (url: string, init: RequestInit) => {
  sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
  const reply = replies.shift();
  if (!reply) throw new Error(`unexpected speech request #${sent.length}`);
  return reply();
});
const ensureOk = mock(async (res: Response) => res);
mock.module("./http", () => ({ fetchWithTimeout, ensureOk }));

const { buildGeminiTtsBody, synthesizeGemini } = await import("./geminiTtsClient");

const PCM = new Uint8Array([1, 2, 3, 4, 5, 6]);

const audioReply = (mimeType = "audio/L16;codec=pcm;rate=24000", data = Buffer.from(PCM).toString("base64")) =>
  () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType, data } }] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

const emptyReply = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  sent = [];
  replies = [];
});

test("asks the configured preview model to speak, in the named voice", async () => {
  replies = [audioReply()];

  await synthesizeGemini("Why did you leave?", "Kore");

  expect(sent[0]?.url).toStartWith(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=",
  );
  expect(sent[0]?.body).toEqual(buildGeminiTtsBody("Why did you leave?", "Kore"));
  expect(buildGeminiTtsBody("Why did you leave?", "Kore")).toEqual({
    contents: [{ role: "user", parts: [{ text: "Why did you leave?" }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  });
});

test("wraps the raw pcm it gets back in a wav a browser can play", async () => {
  replies = [audioReply()];

  const speech = await synthesizeGemini("Why did you leave?", "Kore");

  expect(speech.mime).toBe("audio/wav");
  expect(speech.bytes).toHaveLength(44 + PCM.byteLength);
  expect(String.fromCharCode(...speech.bytes.slice(0, 4))).toBe("RIFF");
  expect(Array.from(speech.bytes.slice(44))).toEqual(Array.from(PCM));
});

test("takes the sample rate from the mime type rather than assuming one", async () => {
  replies = [audioReply("audio/L16;codec=pcm;rate=16000")];

  const speech = await synthesizeGemini("Why did you leave?", "Kore");
  const v = new DataView(speech.bytes.buffer, speech.bytes.byteOffset, speech.bytes.byteLength);

  expect(v.getUint32(24, true)).toBe(16_000);
});

test("refuses a reply with no audio in it instead of caching silence", async () => {
  replies = Array.from({ length: 7 }, () => emptyReply);

  const err = await synthesizeGemini("Why did you leave?", "Kore").catch((e) => e);

  expect(err).toBeInstanceOf(AllKeysExhausted);
  expect((err as AllKeysExhausted).lastError).toBeInstanceOf(Error);
  expect(((err as AllKeysExhausted).lastError as Error).message).toBe(
    "gemini-tts: no audio part in response",
  );
});
