import { describe, expect, test } from "bun:test";
import { AppError } from "@/lib/errors";
import { companyFromSlug, parseJobUrl } from "./urlParsers";

const GH = "https://boards.greenhouse.io/acme/jobs/4012345";
const LEVER = "https://jobs.lever.co/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const ASHBY = "https://jobs.ashbyhq.com/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function refusalCode(raw: string): string {
  try {
    parseJobUrl(raw);
    return "";
  } catch (err) {
    return err instanceof AppError ? err.code : "";
  }
}

describe("parseJobUrl recognises each ATS", () => {
  test("greenhouse, on both board hosts", () => {
    expect(parseJobUrl(GH)).toEqual({
      kind: "greenhouse",
      board: "acme",
      jobId: "4012345",
      api: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345",
    });
    expect(parseJobUrl("https://job-boards.greenhouse.io/acme/jobs/4012345").kind).toBe("greenhouse");
    expect(parseJobUrl("https://job-boards.eu.greenhouse.io/acme/jobs/4012345").kind).toBe("greenhouse");
  });

  test("lever", () => {
    expect(parseJobUrl(LEVER)).toEqual({
      kind: "lever",
      company: "acme",
      postingId: "1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
      api: "https://api.lever.co/v0/postings/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    });
  });

  test("ashby points at the whole board — there is no single-posting endpoint", () => {
    expect(parseJobUrl(ASHBY)).toEqual({
      kind: "ashby",
      org: "acme",
      jobId: "1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
      api: "https://api.ashbyhq.com/posting-api/job-board/acme",
    });
  });

  test("query strings and trailing slashes don't change the recognition", () => {
    expect(parseJobUrl(`${GH}/?gh_src=abc&utm_campaign=x`).kind).toBe("greenhouse");
    expect(parseJobUrl(`${LEVER}?lever-origin=applied`).kind).toBe("lever");
  });

  test("the host is matched case-insensitively, as DNS does", () => {
    expect(parseJobUrl("https://JOBS.LEVER.CO/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d").kind).toBe(
      "lever",
    );
  });
});

describe("parseJobUrl refuses what it cannot safely fetch", () => {
  test("http:// is refused outright, on an ATS host as well as anywhere else", () => {
    expect(refusalCode("http://jobs.lever.co/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d")).toBe(
      "bad_job_url",
    );
    expect(refusalCode("http://careers.acme.com/jobs/1")).toBe("bad_job_url");
  });

  test("a string that isn't a URL at all is a 400, not a generic import", () => {
    expect(refusalCode("acme.com/jobs/1")).toBe("bad_job_url");
    expect(refusalCode("")).toBe("bad_job_url");
    expect(refusalCode("not a url")).toBe("bad_job_url");
  });

  test("javascript: and data: never survive the protocol check", () => {
    expect(refusalCode("javascript:alert(1)")).toBe("bad_job_url");
    expect(refusalCode("data:text/html,<h1>hi</h1>")).toBe("bad_job_url");
    expect(refusalCode("file:///etc/passwd")).toBe("bad_job_url");
  });
});

describe("path traversal never reaches a built API URL", () => {
  test("a dotted slug can't match, so the URL falls through to generic", () => {
    const parsed = parseJobUrl("https://jobs.lever.co/..%2f..%2fadmin/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d");
    expect(parsed.kind).toBe("generic");
  });

  test("an unencoded ../ is normalised away by URL parsing before the slug is read", () => {
    const parsed = parseJobUrl("https://jobs.lever.co/../acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d");
    expect(parsed.kind).toBe("lever");
    if (parsed.kind !== "lever") throw new Error("unreachable");
    expect(parsed.api).toBe(
      "https://api.lever.co/v0/postings/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    );
    expect(parsed.api).not.toContain("..");
  });

  test("a greenhouse job id must be digits, so it can never carry a path", () => {
    expect(parseJobUrl("https://boards.greenhouse.io/acme/jobs/4012345%2f..%2fx").kind).toBe("generic");
    expect(parseJobUrl("https://boards.greenhouse.io/acme/jobs/not-a-number").kind).toBe("generic");
  });

  test("a lever posting id must be a UUID, so a slug there falls through", () => {
    expect(parseJobUrl("https://jobs.lever.co/acme/apply").kind).toBe("generic");
  });

  test("every built API URL starts at its literal host", () => {
    for (const raw of [GH, LEVER, ASHBY]) {
      const parsed = parseJobUrl(raw);
      if (parsed.kind === "generic") throw new Error("expected an ATS kind");
      expect(new URL(parsed.api).protocol).toBe("https:");
      expect(["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"]).toContain(
        new URL(parsed.api).hostname,
      );
    }
  });
});

describe("unknown hosts become generic", () => {
  test("a company careers page", () => {
    expect(parseJobUrl("https://careers.acme.com/roles/senior-backend")).toEqual({
      kind: "generic",
      url: "https://careers.acme.com/roles/senior-backend",
    });
  });

  test("a lookalike host is not the ATS", () => {
    expect(parseJobUrl("https://jobs.lever.co.evil.test/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d").kind).toBe(
      "generic",
    );
    expect(parseJobUrl("https://evil.test/jobs.lever.co/acme/x").kind).toBe("generic");
  });
});

describe("companyFromSlug", () => {
  test("separators become spaces and words are capitalised", () => {
    expect(companyFromSlug("acme")).toBe("Acme");
    expect(companyFromSlug("acme-inc")).toBe("Acme Inc");
    expect(companyFromSlug("acme_labs-india")).toBe("Acme Labs India");
  });

  test("an all-caps word is left exactly as the board wrote it", () => {
    expect(companyFromSlug("IBM")).toBe("IBM");
    expect(companyFromSlug("IBM-research")).toBe("IBM Research");
  });
});
