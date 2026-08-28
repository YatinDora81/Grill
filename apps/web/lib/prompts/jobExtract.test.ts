import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const { JOB_DESCRIPTION_MAX_CHARS } = await import("@/lib/schemas");
const { JOB_EXTRACT_SYSTEM, JOB_PAGE_PROMPT_MAX_CHARS, jobExtractPrompt } = await import("./jobExtract");

const PAGE = `Acme Careers
Senior Backend Engineer — Bengaluru
You will own the billing pipeline. 5+ years of Go. Postgres at scale.
Cookie preferences · Similar jobs · © Acme`;

describe("JOB_EXTRACT_SYSTEM says what it must", () => {
  test("it forbids summarising and inventing, which is the whole point", () => {
    expect(JOB_EXTRACT_SYSTEM).toMatch(/do not summarise/i);
    expect(JOB_EXTRACT_SYSTEM).toMatch(/do not add a single requirement the page does not state/i);
  });

  test("a page that is not a posting must come back with an empty description", () => {
    expect(JOB_EXTRACT_SYSTEM).toMatch(/NOT a single job posting/i);
    expect(JOB_EXTRACT_SYSTEM).toMatch(/empty string/i);
  });

  test("it refuses to guess a company from the domain or name the job board as one", () => {
    expect(JOB_EXTRACT_SYSTEM).toMatch(/never guess a\s+company from the domain/i);
    expect(JOB_EXTRACT_SYSTEM).toMatch(/LinkedIn/);
  });

  test("the exact keys and their nullability are spelled out", () => {
    for (const key of ["title", "company", "location", "description"]) {
      expect(JOB_EXTRACT_SYSTEM).toContain(`"${key}"`);
    }
    expect(JOB_EXTRACT_SYSTEM).toContain("string | null");
    expect(JOB_EXTRACT_SYSTEM).toMatch(/no prose, no code fences/i);
  });
});

describe("jobExtractPrompt carries the page", () => {
  test("the page text reaches the model under a label", () => {
    const p = jobExtractPrompt(PAGE);
    expect(p).toContain("PAGE TEXT:");
    expect(p).toContain("You will own the billing pipeline.");
  });

  test("the text is trimmed, so a scraped page's leading blank lines don't shift the label", () => {
    const p = jobExtractPrompt(`\n\n  ${PAGE}  \n`);
    expect(p).toContain(`PAGE TEXT:\n${PAGE}\n`);
  });

  test("without context there is no empty header, only the page", () => {
    const p = jobExtractPrompt(PAGE);
    expect(p.startsWith("PAGE TEXT:")).toBe(true);
    expect(p).not.toContain("PAGE URL:");
    expect(p).not.toContain("PAGE TITLE:");
  });

  test("the bookmarklet's URL and title ride along above the text when they exist", () => {
    const p = jobExtractPrompt(PAGE, { url: "https://acme.test/j/1", title: "Senior Backend | Acme" });
    expect(p).toContain("PAGE URL: https://acme.test/j/1");
    expect(p).toContain("PAGE TITLE: Senior Backend | Acme");
    expect(p.indexOf("PAGE URL:")).toBeLessThan(p.indexOf("PAGE TEXT:"));
  });

  test("the requested JSON shape and the description ceiling are both stated", () => {
    const p = jobExtractPrompt(PAGE);
    expect(p).toContain('"description": string');
    expect(p).toContain(String(JOB_DESCRIPTION_MAX_CHARS));
  });
});

describe("the page cap actually truncates", () => {
  const overflow = `${"x".repeat(JOB_PAGE_PROMPT_MAX_CHARS)}SENTINEL_TAIL`;

  test("a page longer than the cap is cut, and says so", () => {
    const p = jobExtractPrompt(overflow);
    expect(p).not.toContain("SENTINEL_TAIL");
    expect(p).toContain("[cut off here");
  });

  test("a page at exactly the cap is passed whole, with no cut marker", () => {
    const p = jobExtractPrompt("x".repeat(JOB_PAGE_PROMPT_MAX_CHARS));
    expect(p).not.toContain("[cut off here");
  });

  test("the cap sits under what the JD field stores — a whole page is mostly not the posting", () => {
    expect(JOB_PAGE_PROMPT_MAX_CHARS).toBeLessThan(JOB_DESCRIPTION_MAX_CHARS * 2);
    expect(JOB_PAGE_PROMPT_MAX_CHARS).toBeGreaterThan(JOB_DESCRIPTION_MAX_CHARS);
  });
});
