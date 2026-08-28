import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { z } from "zod";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

interface LlmCall {
  tools: unknown[] | undefined;
  prompt: string;
}

type Step = () => { value: unknown; raw: string; sources: unknown[] } | never;

let calls: LlmCall[] = [];
let script: Step[] = [];

mock.module("@/lib/clients/llmJson", () => ({
  generateJson: async (schema: z.ZodType<unknown>, opts: { prompt: string; tools?: unknown[] }) => {
    calls.push({ tools: opts.tools, prompt: opts.prompt });
    const step = script[calls.length - 1];
    if (!step) throw new Error("script exhausted");
    const out = step();
    return { value: schema.parse(out.value), raw: out.raw, sources: out.sources };
  },
}));

interface Row {
  brief: unknown;
  sources: unknown;
  grounded: boolean;
  createdAt: Date;
}

let stored: Row | null = null;
let lookups: [string, string][] = [];
let upserts: { companyKey: string; roleKey: string; grounded: boolean; brief: unknown }[] = [];

mock.module("@/lib/db/repo", () => ({
  getCompanyBrief: async (companyKey: string, roleKey: string) => {
    lookups.push([companyKey, roleKey]);
    return stored;
  },
  upsertCompanyBrief: async (input: {
    companyKey: string;
    roleKey: string;
    grounded: boolean;
    brief: unknown;
    sources: unknown;
  }) => {
    upserts.push(input);
    return { ...input, createdAt: NOW };
  },
}));

const NOW = new Date("2026-08-26T10:00:00.000Z");

const {
  BRIEF_TTL_MS,
  briefForQuestions,
  buildBrief,
  companyKey,
  getBrief,
  readCachedBrief,
  roleKey,
} = await import("./companyBriefService");
const { AppError } = await import("@/lib/errors");

const BRIEF = {
  what_they_do: "A discount broker that runs its own trading stack.",
  recent_news: [{ headline: "Launched a new clearing system", date: "2026-05", why_it_matters: "They will ask about migrations." }],
  values: ["No external funding", "Build in-house"],
  interview_style_notes: ["One long systems conversation, no whiteboard"],
  likely_questions: ["How would you keep an order book consistent under load?"],
  questions_to_ask: ["What broke last quarter that you are still paying for?"],
};

const EMPTY_BRIEF = {
  what_they_do: "",
  recent_news: [],
  values: [],
  interview_style_notes: [],
  likely_questions: [],
  questions_to_ask: [],
};

const SOURCE = { uri: "https://zerodha.com/z-connect/", title: "Z-Connect" };

const answers = (value: unknown, sources: unknown[] = []): Step => () => ({
  value,
  raw: JSON.stringify(value),
  sources,
});

const fails = (message: string): Step => () => {
  throw new Error(message);
};

function reset(...steps: Step[]) {
  calls = [];
  script = steps;
  stored = null;
  lookups = [];
  upserts = [];
}

beforeEach(() => reset());

describe("cache keys collapse the ways people write one company", () => {
  const table: [input: string, key: string][] = [
    ["Acme Technologies Pvt. Ltd.", "acme"],
    ["Google", "google"],
    ["  google  ", "google"],
    ["Google LLC", "google"],
    ["GOOGLE, Inc.", "google"],
    ["Zerodha Broking Limited", "zerodha broking"],
    ["AT&T", "at&t"],
    ["3M Company", "3m"],
    ["Hewlett-Packard", "hewlett packard"],
    ["Limited Brands", "limited brands"],
  ];

  test.each(table)("companyKey(%p) === %p", (input, key) => {
    expect(companyKey(input)).toBe(key);
  });

  test("a name that is nothing but a suffix keeps a key rather than collapsing to nothing", () => {
    expect(companyKey("Ltd.")).toBe("ltd");
    expect(companyKey("...")).not.toBe("");
  });

  test("a key never exceeds the column it is stored in", () => {
    expect(companyKey("a".repeat(400)).length).toBe(120);
    expect(roleKey("b".repeat(400)).length).toBe(120);
  });

  test("an absent role is the empty string, never null", () => {
    expect(roleKey(null)).toBe("");
    expect(roleKey(undefined)).toBe("");
    expect(roleKey("   ")).toBe("");
    expect(roleKey("  Senior Backend Engineer ")).toBe("senior backend engineer");
  });

  test("two spellings of one company read the same cache row", async () => {
    reset();
    await readCachedBrief({ company: "Google LLC", role: "SRE" });
    await readCachedBrief({ company: "  google ", role: "sre" });
    expect(lookups[0]).toEqual(["google", "sre"]);
    expect(lookups[1]).toEqual(lookups[0]!);
  });
});

describe("the cache is what stops a class of forty paying for forty searches", () => {
  test("a fresh row is returned without a single provider call", async () => {
    reset();
    stored = { brief: BRIEF, sources: [SOURCE], grounded: true, createdAt: new Date(Date.now() - 60_000) };

    const res = await getBrief({ company: "Zerodha" });

    expect(calls).toHaveLength(0);
    expect(upserts).toHaveLength(0);
    expect(res.cached).toBe(true);
    expect(res.grounded).toBe(true);
    expect(res.brief.values).toEqual(BRIEF.values);
    expect(res.sources).toEqual([SOURCE]);
  });

  test("a row past the fortnight is researched again", async () => {
    reset(answers(BRIEF, [SOURCE]));
    stored = {
      brief: BRIEF,
      sources: [SOURCE],
      grounded: true,
      createdAt: new Date(Date.now() - BRIEF_TTL_MS - 1_000),
    };

    const res = await getBrief({ company: "Zerodha" });

    expect(calls).toHaveLength(1);
    expect(upserts).toHaveLength(1);
    expect(res.cached).toBe(false);
  });

  test("refresh researches again even when the row is fresh", async () => {
    reset(answers(BRIEF, [SOURCE]));
    stored = { brief: BRIEF, sources: [SOURCE], grounded: true, createdAt: new Date() };

    const res = await getBrief({ company: "Zerodha", refresh: true });

    expect(lookups).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(res.cached).toBe(false);
  });

  test("a stored brief that no longer parses is a miss, not a broken panel", async () => {
    reset();
    stored = { brief: null, sources: [], grounded: true, createdAt: new Date() };
    expect(await readCachedBrief({ company: "Zerodha" })).toBeNull();
  });

  test("a stored brief with no sources cannot claim to be grounded", async () => {
    reset();
    stored = { brief: BRIEF, sources: [], grounded: true, createdAt: new Date() };
    const res = await readCachedBrief({ company: "Zerodha" });
    expect(res?.grounded).toBe(false);
  });

  test("junk in the sources column is dropped rather than rendered as a link", async () => {
    reset();
    stored = {
      brief: BRIEF,
      sources: [SOURCE, { uri: "javascript:alert(1)", title: "x" }, "nope"],
      grounded: true,
      createdAt: new Date(),
    };
    const res = await readCachedBrief({ company: "Zerodha" });
    expect(res?.sources).toEqual([SOURCE]);
  });
});

describe("research grounds itself when it can and says so when it cannot", () => {
  test("the search tool is requested, and sources make the brief grounded", async () => {
    reset(answers(BRIEF, [SOURCE]));

    const res = await buildBrief({ company: "Zerodha", role: "SRE" });

    expect(calls[0]!.tools).toEqual([{ google_search: {} }]);
    expect(res.grounded).toBe(true);
    expect(res.sources).toEqual([SOURCE]);
    expect(upserts[0]).toMatchObject({ companyKey: "zerodha", roleKey: "sre", grounded: true });
  });

  test("a search that returns no sources is stored ungrounded, without a second call", async () => {
    reset(answers(BRIEF, []));

    const res = await buildBrief({ company: "Zerodha" });

    expect(calls).toHaveLength(1);
    expect(res.grounded).toBe(false);
    expect(res.sources).toEqual([]);
    expect(upserts[0]!.grounded).toBe(false);
  });

  test("exhausted keys fall back to an ungrounded brief with no tools", async () => {
    reset(fails("AllKeysExhausted"), answers(BRIEF, []));

    const res = await buildBrief({ company: "Zerodha" });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.tools).toBeDefined();
    expect(calls[1]!.tools).toBeUndefined();
    expect(res.grounded).toBe(false);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.grounded).toBe(false);
  });

  test("an all-empty brief is never persisted — it is what invented keys look like", async () => {
    reset(answers(EMPTY_BRIEF, [SOURCE]), answers(BRIEF, []));

    const res = await buildBrief({ company: "Zerodha" });

    expect(calls).toHaveLength(2);
    expect(res.brief.what_they_do).toBe(BRIEF.what_they_do);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.brief).toMatchObject({ what_they_do: BRIEF.what_they_do });
  });

  test("both attempts failing is a 503, and nothing is written", async () => {
    reset(fails("no keys"), fails("no keys either"));

    const err = await buildBrief({ company: "Zerodha" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as InstanceType<typeof AppError>).status).toBe(503);
    expect((err as InstanceType<typeof AppError>).code).toBe("brief_unavailable");
    expect(upserts).toHaveLength(0);
  });

  test("an empty brief on both attempts is a 503 rather than a stored blank", async () => {
    reset(answers(EMPTY_BRIEF, []), answers(EMPTY_BRIEF, []));

    const err = await buildBrief({ company: "Zerodha" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(upserts).toHaveLength(0);
  });

  test("what the user typed is stored for display, alongside the normalised key", async () => {
    reset(answers(BRIEF, [SOURCE]));
    await buildBrief({ company: "  Google LLC ", role: "  SRE " });
    expect(upserts[0]).toMatchObject({ companyKey: "google", roleKey: "sre" });
    expect(upserts[0] as unknown as { company: string; role: string }).toMatchObject({
      company: "Google LLC",
      role: "SRE",
    });
  });
});

describe("briefForQuestions never generates", () => {
  test("it hands the generator only values and style notes, from the cache", async () => {
    reset();
    stored = { brief: BRIEF, sources: [SOURCE], grounded: true, createdAt: new Date() };

    const out = await briefForQuestions("Zerodha", null);

    expect(calls).toHaveLength(0);
    expect(out).toEqual({ values: BRIEF.values, style_notes: BRIEF.interview_style_notes });
  });

  test("no company, no cache row, or nothing worth saying all come back null", async () => {
    reset();
    expect(await briefForQuestions(null, null)).toBeNull();
    expect(await briefForQuestions("   ", null)).toBeNull();
    expect(lookups).toHaveLength(0);

    expect(await briefForQuestions("Zerodha", null)).toBeNull();

    stored = {
      brief: { ...BRIEF, values: [], interview_style_notes: [] },
      sources: [],
      grounded: false,
      createdAt: new Date(),
    };
    expect(await briefForQuestions("Zerodha", null)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
