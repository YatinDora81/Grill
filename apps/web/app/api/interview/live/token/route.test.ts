import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const envConfig = {
  liveConfigured: true,
  live: { model: "gemini-live-test", maxConcurrent: 2, maxMinutes: 12 },
  gemini: { keys: [{ label: "#0", key: "gemini-key" }] },
  groq: { keys: [] },
  rotation: { baseBackoffMs: 1 },
  auth: { passwordMinLength: 8 },
  interview: { defaultNumQuestions: 8 },
  video: { maxParts: 1_000 },
};
mock.module("@/lib/env", () => ({ config: envConfig }));

mock.module("@/lib/auth", () => ({ requireUserId: async () => "user-1" }));
mock.module("@/lib/rateLimit", () => ({ rateLimit: async () => {} }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

let sessionStatus = "in_progress";
let live = true;
let openerRow: { turnIndex: number; question: string } | null = {
  turnIndex: 0,
  question: "Why did the ledger drift?",
};

mock.module("@/lib/db/repo", () => ({
  getSession: async (id: string, userId: string) =>
    id === SESSION_ID && userId === "user-1"
      ? { id: SESSION_ID, userId: "user-1", status: sessionStatus }
      : null,
  getTurn: async (_id: string, turnIndex: number) => (turnIndex === 0 ? openerRow : null),
}));

mock.module("@/lib/services/sessionContext", () => ({
  toSessionContext: () => ({
    sourceType: "resume",
    sourceText: "Ten years on payments.",
    role: "Staff engineer",
    config: {
      num_questions: 6,
      difficulty: "hard",
      persona: "terse_staff",
      sources: ["resume"],
      mode: null,
      allow_repeats: false,
      live,
    },
  }),
}));

const acquireLiveSlot = mock(async () => {});
mock.module("@/lib/services/liveService", () => ({ acquireLiveSlot }));

let created: unknown = null;
const create = mock(async (params: unknown) => {
  created = params;
  return { name: "auth_tokens/secret-value" };
});

class FakeGoogleGenAI {
  authTokens = { create };
  constructor(public readonly options: unknown) {}
}
mock.module("@google/genai", () => ({
  GoogleGenAI: FakeGoogleGenAI,
  Modality: { AUDIO: "AUDIO" },
}));

const { POST } = await import("./route");

function post(body: unknown = { session_id: SESSION_ID }) {
  return POST(
    new Request("https://example.test/api/interview/live/token", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  envConfig.liveConfigured = true;
  sessionStatus = "in_progress";
  live = true;
  openerRow = { turnIndex: 0, question: "Why did the ledger drift?" };
  created = null;
  create.mockClear();
  acquireLiveSlot.mockClear();
});

test("a server without live mode says so rather than minting anything", async () => {
  envConfig.liveConfigured = false;

  const res = await post();

  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: { code: "live_disabled" } });
  expect(create).not.toHaveBeenCalled();
});

test("a session that never asked for live mode is refused", async () => {
  live = false;

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "not_live" } });
  expect(create).not.toHaveBeenCalled();
});

test("an interview that is over cannot open a live socket", async () => {
  sessionStatus = "completed";

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "session_not_active" } });
});

test("a session with no opening question is a conflict", async () => {
  openerRow = null;

  const res = await post();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "unknown_turn" } });
});

test("the happy path mints a single-use token with exactly our fields locked", async () => {
  const res = await post();

  expect(res.status).toBe(200);
  expect(acquireLiveSlot).toHaveBeenCalledWith(SESSION_ID);

  const params = created as {
    config: {
      uses: number;
      lockAdditionalFields: string[];
      expireTime: string;
      newSessionExpireTime: string;
      liveConnectConstraints: {
        model: string;
        config: {
          responseModalities: string[];
          systemInstruction: string;
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
          };
          inputAudioTranscription: unknown;
          outputAudioTranscription: unknown;
        };
      };
    };
  };
  expect(params.config.uses).toBe(1);
  expect(params.config.lockAdditionalFields).toEqual([]);
  expect(params.config.liveConnectConstraints.model).toBe("gemini-live-test");
  expect(params.config.liveConnectConstraints.config.responseModalities).toEqual(["AUDIO"]);
  expect(params.config.liveConnectConstraints.config.systemInstruction).toContain(
    "Why did the ledger drift?",
  );
  expect(
    params.config.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig
      .voiceName,
  ).toBe("Charon");
  expect(params.config.liveConnectConstraints.config.inputAudioTranscription).toEqual({});
  expect(params.config.liveConnectConstraints.config.outputAudioTranscription).toEqual({});
  expect(new Date(params.config.newSessionExpireTime).getTime()).toBeLessThan(
    new Date(params.config.expireTime).getTime(),
  );

  expect(await res.json()).toMatchObject({
    token: "auth_tokens/secret-value",
    model: "gemini-live-test",
    opener: "Why did the ledger drift?",
    max_minutes: 12,
  });
});

test("a nameless token from the sdk is reported rather than handed to the browser", async () => {
  create.mockImplementationOnce(async () => ({}));

  const res = await post();

  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: { code: "live_token_failed" } });
});

test("a rate-limited key rotates instead of failing the request outright", async () => {
  create.mockImplementationOnce(async () => {
    throw Object.assign(new Error("quota"), { status: 429 });
  });

  const res = await post();

  expect(res.status).toBe(200);
  expect(create.mock.calls.length).toBeGreaterThan(1);
});

test("a bad session id never reaches the provider", async () => {
  const res = await post({ session_id: "not-a-uuid" });

  expect(res.status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});
