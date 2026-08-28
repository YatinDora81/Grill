import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const envConfig = {
  site: { url: "https://grill.test" },
  qstash: {
    token: "qstash-token",
    currentSigningKey: "sig-current",
    nextSigningKey: "sig-next",
  },
  get qstashConfigured(): boolean {
    return Boolean(
      this.qstash.token && this.qstash.currentSigningKey && this.qstash.nextSigningKey,
    );
  },
  auth: { passwordMinLength: 8 },
  interview: { defaultNumQuestions: 8 },
  video: { maxParts: 200 },
  gemini: { keys: [], model: "gemini-test" },
  groq: { keys: [], whisperModel: "whisper-test", llmFallbackModel: "llm-test" },
  rotation: { baseBackoffMs: 1, providerTimeoutMs: 1_000 },
};
mock.module("@/lib/env", () => ({ config: envConfig }));
mock.module("./env", () => ({ config: envConfig }));

const published: Record<string, unknown>[] = [];

let verifyOutcome: "ok" | "no" | "throw" = "ok";
const verified: { signature: string; body: string; url?: string }[] = [];
const receiversBuilt: string[] = [];

mock.module("@upstash/qstash", () => ({
  Client: class {
    constructor(readonly opts: { token: string }) {}
    async publishJSON(request: Record<string, unknown>) {
      published.push(request);
      return { messageId: "msg_1" };
    }
  },
  Receiver: class {
    constructor(opts: { currentSigningKey: string; nextSigningKey: string }) {
      receiversBuilt.push(`${opts.currentSigningKey}:${opts.nextSigningKey}`);
    }
    async verify(request: { signature: string; body: string; url?: string }) {
      verified.push(request);
      if (verifyOutcome === "throw") throw new Error("SignatureError");
      return verifyOutcome === "ok";
    }
  },
}));

let outcome = "built";
const claims: { sessionId: string; opts: unknown }[] = [];
mock.module("@/lib/services/reportQueue", () => ({
  claimAndBuild: async (sessionId: string, opts: unknown) => {
    claims.push({ sessionId, opts });
    return outcome;
  },
}));
mock.module("@/lib/services/videoService", () => ({ VIDEO_FLUSH_GRACE_MS: 120_000 }));

const { publishReportBuild, qstashConfigured, reportWorkerUrl, verifyQstash } = await import(
  "./qstash"
);
const { POST } = await import("@/app/api/queue/report/route");

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

function delivery(body: string, signature = "sig.payload.mac"): Request {
  return new Request("https://grill.test/api/queue/report", {
    method: "POST",
    headers: { "upstash-signature": signature },
    body,
  });
}

function resetConfig(): void {
  envConfig.site.url = "https://grill.test";
  envConfig.qstash.token = "qstash-token";
  envConfig.qstash.currentSigningKey = "sig-current";
  envConfig.qstash.nextSigningKey = "sig-next";
}

beforeEach(() => {
  resetConfig();
  published.length = 0;
  verified.length = 0;
  receiversBuilt.length = 0;
  claims.length = 0;
  verifyOutcome = "ok";
  outcome = "built";
});

describe("qstashConfigured", () => {
  test("is true only when the token and both signing keys are set", () => {
    expect(qstashConfigured()).toBe(true);

    envConfig.qstash.nextSigningKey = "";
    expect(qstashConfigured()).toBe(false);

    resetConfig();
    envConfig.qstash.token = "";
    expect(qstashConfigured()).toBe(false);
  });
});

describe("reportWorkerUrl", () => {
  test("is the site origin plus the worker path", () => {
    expect(reportWorkerUrl()).toBe("https://grill.test/api/queue/report");
  });

  test("moves with the configured origin, so publish and verify cannot drift", () => {
    envConfig.site.url = "https://preview.grill.test";
    expect(reportWorkerUrl()).toBe("https://preview.grill.test/api/queue/report");
  });
});

describe("publishReportBuild", () => {
  test("publishes the session id to the worker, with retries and a dedup key", async () => {
    await publishReportBuild(SESSION_ID);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      url: "https://grill.test/api/queue/report",
      body: { session_id: SESSION_ID },
      retries: 3,
      deduplicationId: `report:${SESSION_ID}`,
    });
  });

  test("refuses when QStash is not configured, so the caller keeps after()", async () => {
    envConfig.qstash.token = "";

    await expect(publishReportBuild(SESSION_ID)).rejects.toThrow(/not configured/i);
    expect(published).toHaveLength(0);
  });

  test("refuses a destination QStash could never reach", async () => {
    envConfig.site.url = "http://localhost:4000";

    await expect(publishReportBuild(SESSION_ID)).rejects.toThrow(/localhost:4000/);
    expect(published).toHaveLength(0);
  });
});

describe("verifyQstash", () => {
  test("passes the signature, the raw body and the destination to the receiver", async () => {
    const body = JSON.stringify({ session_id: SESSION_ID });

    await verifyQstash(delivery(body), body);

    expect(verified).toEqual([
      { signature: "sig.payload.mac", body, url: "https://grill.test/api/queue/report" },
    ]);
  });

  test("refuses a request with no signature header without consulting the receiver", async () => {
    const req = new Request("https://grill.test/api/queue/report", { method: "POST", body: "{}" });

    await expect(verifyQstash(req, "{}")).rejects.toMatchObject({
      status: 401,
      code: "bad_signature",
    });
    expect(verified).toHaveLength(0);
  });

  test("refuses when the receiver says no", async () => {
    verifyOutcome = "no";

    await expect(verifyQstash(delivery("{}"), "{}")).rejects.toMatchObject({
      status: 401,
      code: "bad_signature",
    });
  });

  test("refuses when the receiver throws, rather than surfacing a 500", async () => {
    verifyOutcome = "throw";

    await expect(verifyQstash(delivery("{}"), "{}")).rejects.toMatchObject({
      status: 401,
      code: "bad_signature",
    });
  });

  test("rebuilds the receiver when the signing keys rotate under it", async () => {
    await verifyQstash(delivery("{}"), "{}");
    const built = receiversBuilt.length;

    envConfig.qstash.currentSigningKey = "sig-rotated";
    await verifyQstash(delivery("{}"), "{}");

    expect(receiversBuilt.length).toBe(built + 1);
    expect(receiversBuilt.at(-1)).toBe("sig-rotated:sig-next");
  });

  test("refuses everything while QStash is unconfigured — the endpoint is never open", async () => {
    envConfig.qstash.currentSigningKey = "";

    await expect(verifyQstash(delivery("{}"), "{}")).rejects.toMatchObject({
      status: 401,
      code: "bad_signature",
    });
    expect(verified).toHaveLength(0);
  });
});

describe("POST /api/queue/report", () => {
  test("a bad signature is a 401 and never reaches the builder", async () => {
    verifyOutcome = "no";

    const res = await POST(delivery(JSON.stringify({ session_id: SESSION_ID })));

    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "bad_signature" },
    });
    expect(claims).toHaveLength(0);
  });

  test("a verified delivery builds the session with the video flush grace", async () => {
    const res = await POST(delivery(JSON.stringify({ session_id: SESSION_ID })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session_id: SESSION_ID, outcome: "built" });
    expect(claims).toEqual([{ sessionId: SESSION_ID, opts: { videoGraceMs: 120_000 } }]);
  });

  test.each(["already_built", "not_claimed"])(
    "%s is a 200, so a duplicate delivery is not retried",
    async (settled) => {
      outcome = settled;

      const res = await POST(delivery(JSON.stringify({ session_id: SESSION_ID })));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ session_id: SESSION_ID, outcome: settled });
    },
  );

  test("failed is a 500, which is what asks QStash to deliver it again", async () => {
    outcome = "failed";

    const res = await POST(delivery(JSON.stringify({ session_id: SESSION_ID })));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ session_id: SESSION_ID, outcome: "failed" });
  });

  test("a signed body that is not JSON is a 400, not an unhandled 500", async () => {
    const res = await POST(delivery("not json at all"));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "bad_message" },
    });
    expect(claims).toHaveLength(0);
  });

  test("a signed body without a session id is a validation error, not a build", async () => {
    const res = await POST(delivery(JSON.stringify({ session_id: "not-a-uuid" })));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(claims).toHaveLength(0);
  });

  test("verifies the exact bytes it received, not a re-serialised object", async () => {
    const body = `{ "session_id": "${SESSION_ID}" }`;

    await POST(delivery(body));

    expect(verified[0]?.body).toBe(body);
  });
});
