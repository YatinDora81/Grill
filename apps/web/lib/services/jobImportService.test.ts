import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const generateJson = mock(async () => {
  throw new Error("the LLM should not have been called");
});
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const { importJob, importJobFromPageText } = await import("./jobImportService");
const { AppError } = await import("@/lib/errors");

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

let replies: Reply[] = [];
let requested: string[] = [];
const realFetch = globalThis.fetch;

const LONG = "Own the billing pipeline end to end, from ingestion to invoicing. ".repeat(6);

beforeEach(() => {
  replies = [];
  requested = [];
  generateJson.mockClear();
  generateJson.mockImplementation(async () => {
    throw new Error("the LLM should not have been called");
  });
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    requested.push(String(input));
    const reply = replies.shift() ?? { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.headers ?? { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const jsonReply = (payload: unknown): Reply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const htmlReply = (body: string): Reply => ({
  status: 200,
  headers: { "content-type": "text/html" },
  body,
});

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    return err instanceof AppError ? err.code : `unexpected: ${String(err)}`;
  }
}

const LEVER_URL = "https://jobs.lever.co/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const ASHBY_URL = "https://jobs.ashbyhq.com/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const GH_URL = "https://boards.greenhouse.io/acme/jobs/4012345";

describe("Greenhouse", () => {
  test("the double-encoded body is decoded, stripped and returned — with no model call", async () => {
    replies = [
      jsonReply({
        title: "Senior Backend Engineer",
        content: `&lt;p&gt;${LONG}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go &amp;amp; Postgres&lt;/li&gt;&lt;/ul&gt;`,
        location: { name: "Bengaluru, India" },
      }),
    ];

    const job = await importJob(GH_URL);

    expect(requested).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345"]);
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.location).toBe("Bengaluru, India");
    expect(job.source).toBe("greenhouse");
    expect(job.url).toBe(GH_URL);
    expect(job.description).toContain("• Go & Postgres");
    expect(job.description).not.toContain("<p>");
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("the board slug becomes the company, tidied — unless the payload names one", async () => {
    replies = [jsonReply({ title: "T", content: LONG })];
    expect((await importJob("https://boards.greenhouse.io/acme-labs/jobs/1")).company).toBe("Acme Labs");

    replies = [jsonReply({ title: "T", content: LONG, company_name: "Acme Corporation" })];
    expect((await importJob(GH_URL)).company).toBe("Acme Corporation");
  });

  test("a 404 from the board is job_not_found, not a generic failure", async () => {
    replies = [{ status: 404, headers: { "content-type": "application/json" }, body: "{}" }];
    expect(await refusal(() => importJob(GH_URL))).toBe("job_not_found");
  });

  test("a posting with almost no body is not a posting", async () => {
    replies = [jsonReply({ title: "T", content: "&lt;p&gt;Apply here&lt;/p&gt;" })];
    expect(await refusal(() => importJob(GH_URL))).toBe("not_a_posting");
  });
});

describe("Lever", () => {
  test("the intro, the titled lists and the closing note are all joined", async () => {
    replies = [
      jsonReply({
        text: "Staff Engineer",
        descriptionPlain: LONG,
        lists: [
          { text: "What you'll do", content: "<ul><li>Own billing</li><li>Mentor</li></ul>" },
          { text: "Requirements", content: "<ul><li>5+ years Go</li></ul>" },
        ],
        additionalPlain: "We interview in three rounds.",
        categories: { location: "Remote — India", team: "Platform" },
      }),
    ];

    const job = await importJob(LEVER_URL);

    expect(requested).toEqual([
      "https://api.lever.co/v0/postings/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    ]);
    expect(job.title).toBe("Staff Engineer");
    expect(job.company).toBe("Acme");
    expect(job.location).toBe("Remote — India");
    expect(job.source).toBe("lever");
    expect(job.description).toContain("What you'll do");
    expect(job.description).toContain("• Own billing");
    expect(job.description).toContain("Requirements");
    expect(job.description).toContain("• 5+ years Go");
    expect(job.description).toContain("We interview in three rounds.");
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("a posting with no lists at all still imports", async () => {
    replies = [jsonReply({ text: "Engineer", descriptionPlain: LONG, categories: null })];
    const job = await importJob(LEVER_URL);
    expect(job.description).toContain("Own the billing pipeline");
    expect(job.location).toBeNull();
  });
});

describe("Ashby", () => {
  test("the id in the URL picks one posting out of the whole board", async () => {
    replies = [
      jsonReply({
        jobs: [
          { id: "aaaaaaaa-0000-4000-8000-000000000000", title: "Designer", descriptionPlain: LONG },
          {
            id: "1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
            title: "Backend Engineer",
            descriptionPlain: LONG,
            location: "London",
          },
        ],
      }),
    ];

    const job = await importJob(ASHBY_URL);

    expect(requested).toEqual(["https://api.ashbyhq.com/posting-api/job-board/acme"]);
    expect(job.title).toBe("Backend Engineer");
    expect(job.location).toBe("London");
    expect(job.source).toBe("ashby");
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("an id that isn't on the board is job_not_found", async () => {
    replies = [jsonReply({ jobs: [{ id: "aaaaaaaa-0000-4000-8000-000000000000", title: "Designer" }] })];
    expect(await refusal(() => importJob(ASHBY_URL))).toBe("job_not_found");
  });

  test("descriptionHtml is used when the plain form is missing", async () => {
    replies = [
      jsonReply({
        jobs: [
          {
            id: "1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
            title: "Backend Engineer",
            descriptionHtml: `<p>${LONG}</p>`,
          },
        ],
      }),
    ];
    const job = await importJob(ASHBY_URL);
    expect(job.description).not.toContain("<p>");
    expect(job.description).toContain("Own the billing pipeline");
  });
});

describe("a generic page", () => {
  test("JSON-LD is used when the page has it, and costs no model call", async () => {
    const ld = {
      "@type": "JobPosting",
      title: "Senior Backend Engineer",
      description: `<p>${LONG}</p>`,
      hiringOrganization: { name: "Acme" },
      jobLocation: { address: { addressLocality: "Bengaluru" } },
    };
    replies = [
      htmlReply(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>x</body></html>`),
    ];

    const job = await importJob("https://careers.acme.com/jobs/42");

    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.company).toBe("Acme");
    expect(job.location).toBe("Bengaluru");
    expect(job.source).toBe("generic");
    expect(job.description).not.toContain("<p>");
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("without JSON-LD the model is called exactly once, on the stripped text", async () => {
    replies = [htmlReply(`<html><body><nav>Jobs</nav><p>${LONG}</p></body></html>`)];
    generateJson.mockImplementation(async () => ({
      value: {
        title: "Senior Backend Engineer",
        company: "Acme",
        location: "Remote",
        description: LONG,
      },
      raw: "{}",
    }));

    const job = await importJob("https://careers.acme.com/jobs/42");

    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(job.source).toBe("generic");
    expect(job.company).toBe("Acme");
    const prompt = (generateJson.mock.calls[0]?.[1] as { prompt: string }).prompt;
    expect(prompt).not.toContain("<nav>");
    expect(prompt).toContain("Own the billing pipeline");
  });

  test("a stub JSON-LD description falls through to the model rather than shipping a stub", async () => {
    const ld = { "@type": "JobPosting", title: "Backend Engineer", description: "Backend Engineer" };
    replies = [
      htmlReply(
        `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><p>${LONG}</p></body></html>`,
      ),
    ];
    generateJson.mockImplementation(async () => ({
      value: { title: "Backend Engineer", company: null, location: null, description: LONG },
      raw: "{}",
    }));

    const job = await importJob("https://careers.acme.com/jobs/42");
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(job.description.length).toBeGreaterThan(200);
  });

  test("a page the model says is not a posting becomes 422 not_a_posting", async () => {
    replies = [htmlReply(`<html><body><p>${LONG}</p></body></html>`)];
    generateJson.mockImplementation(async () => ({
      value: { title: "", company: null, location: null, description: "" },
      raw: "{}",
    }));

    expect(await refusal(() => importJob("https://careers.acme.com/search"))).toBe("not_a_posting");
  });

  test("a nearly empty page is refused before a model call is spent on it", async () => {
    replies = [htmlReply("<html><body><p>Loading…</p></body></html>")];
    expect(await refusal(() => importJob("https://careers.acme.com/jobs/42"))).toBe("not_a_posting");
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("a login-walled page surfaces login_wall so the form can offer the bookmarklet", async () => {
    replies = [{ status: 999, headers: { "content-type": "text/html" }, body: "no" }];
    expect(await refusal(() => importJob("https://www.linkedin.com/jobs/view/1"))).toBe("login_wall");
  });
});

describe("importJobFromPageText", () => {
  test("nothing is fetched — the browser already read the page", async () => {
    generateJson.mockImplementation(async () => ({
      value: { title: "Senior Backend Engineer", company: "Acme", location: "Remote", description: LONG },
      raw: "{}",
    }));

    const job = await importJobFromPageText({
      url: "https://www.linkedin.com/jobs/view/1",
      pageTitle: "Senior Backend Engineer | Acme | LinkedIn",
      pageText: LONG,
    });

    expect(requested).toEqual([]);
    expect(job.source).toBe("bookmarklet");
    expect(job.url).toBe("https://www.linkedin.com/jobs/view/1");
    expect(job.title).toBe("Senior Backend Engineer");
  });

  test("the page title is the fallback title when the model returns none", async () => {
    generateJson.mockImplementation(async () => ({
      value: { title: "", company: null, location: null, description: LONG },
      raw: "{}",
    }));

    const job = await importJobFromPageText({
      url: "https://www.linkedin.com/jobs/view/1",
      pageTitle: "Senior Backend Engineer | Acme",
      pageText: LONG,
    });
    expect(job.title).toBe("Senior Backend Engineer | Acme");
  });

  test("text too short to be a posting is refused without a model call", async () => {
    expect(
      await refusal(() =>
        importJobFromPageText({ url: "https://x.test/j", pageText: "Sign in to view this job" }),
      ),
    ).toBe("not_a_posting");
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("every path", () => {
  test("caps the description at what the JD field will store", async () => {
    replies = [jsonReply({ text: "Engineer", descriptionPlain: "z".repeat(60_000) })];
    const job = await importJob(LEVER_URL);
    expect(job.description.length).toBeLessThanOrEqual(20_000);
  });

  test("returns null for a company the source never named — never a guess", async () => {
    replies = [htmlReply(`<html><body><p>${LONG}</p></body></html>`)];
    generateJson.mockImplementation(async () => ({
      value: { title: "Engineer", company: null, location: null, description: LONG },
      raw: "{}",
    }));
    const job = await importJob("https://careers.acme.com/jobs/42");
    expect(job.company).toBeNull();
    expect(job.location).toBeNull();
  });

  test("an unreachable board is a 502 the form can explain, not a 500", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await refusal(() => importJob(LEVER_URL))).toBe("board_unavailable");
  });

  test("a non-https URL never reaches a fetch", async () => {
    expect(await refusal(() => importJob("http://jobs.lever.co/acme/x"))).toBe("bad_job_url");
    expect(requested).toEqual([]);
  });
});
