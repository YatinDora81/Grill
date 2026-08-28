import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { AppError } from "@/lib/errors";

mock.module("server-only", () => ({}));

const envConfig = {
  gemini: { keys: [] as { label: string; key: string }[] },
  groq: { keys: [] as { label: string; key: string }[] },
  tts: { model: "canopylabs/orpheus-v1-english" },
  rotation: { baseBackoffMs: 0, providerTimeoutMs: 5_000 },
};
mock.module("@/lib/env", () => ({ config: envConfig }));

envConfig.groq.keys = [
  { label: "one", key: "gsk-key-one" },
  { label: "two", key: "gsk-key-two" },
];

const { SPEECH_FORMAT, synthesize } = await import("./ttsClient");
const { groqPool } = await import("./keyPool");

const realFetch = globalThis.fetch;

interface Sent {
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

let sent: Sent[] = [];

function serve(...replies: Array<() => Response>) {
  let i = 0;
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const reply = replies[i++];
    if (!reply) throw new Error(`unexpected speech request #${i}`);
    return reply();
  }) as unknown as typeof fetch;
}

const clip = (bytes: number[], contentType = "audio/wav") => () =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });

const status = (code: number) => () => new Response("busy", { status: code });

beforeEach(() => {
  sent = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test("asks Groq for the configured model, the given voice and the cacheable format", async () => {
  serve(clip([1, 2, 3, 4]));

  const speech = await synthesize("[cheerful] Tell me about a time you shipped late.", "autumn");

  expect(sent[0]?.url).toBe("https://api.groq.com/openai/v1/audio/speech");
  expect(sent[0]?.auth).toBe("Bearer gsk-key-one");
  expect(sent[0]?.body).toEqual({
    model: "canopylabs/orpheus-v1-english",
    voice: "autumn",
    input: "[cheerful] Tell me about a time you shipped late.",
    response_format: SPEECH_FORMAT,
  });
  expect(Array.from(speech.bytes)).toEqual([1, 2, 3, 4]);
});

test("keeps only the media type when the response carries content-type parameters", async () => {
  serve(clip([9], "audio/wav; charset=binary"));

  const speech = await synthesize("Why did you leave?", "hannah");
  expect(speech.mime).toBe("audio/wav");
});

test("names a plausible mime rather than an empty one when Groq omits the header", async () => {
  serve(() => new Response(new Uint8Array([7]), { status: 200 }));

  const speech = await synthesize("Why did you leave?", "hannah");
  expect(speech.mime).toBe("audio/wav");
});

test("rotates to the next key when one is rate limited", async () => {
  serve(status(429), clip([5, 6]));

  const speech = await synthesize("What broke?", "troy");

  expect(sent).toHaveLength(2);
  expect(sent[0]?.auth).not.toBe(sent[1]?.auth);
  expect(Array.from(speech.bytes)).toEqual([5, 6]);
});

test("rejects an empty clip instead of handing back cacheable silence", async () => {
  serve(clip([]));

  const err = await synthesize("What broke?", "troy").catch((e) => e);

  expect(sent).toHaveLength(1);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe("tts_empty");
});

test("refuses without calling out when there are no Groq keys at all", async () => {
  serve();
  const emptyPool = groqPool.keys.splice(0, groqPool.keys.length);

  try {
    const err = await synthesize("What broke?", "troy").catch((e) => e);

    expect(sent).toHaveLength(0);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(503);
    expect((err as AppError).code).toBe("tts_unavailable");
  } finally {
    groqPool.keys.push(...emptyPool);
  }
});
