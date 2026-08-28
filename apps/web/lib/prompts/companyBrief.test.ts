import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const { COMPANY_MAX_CHARS } = await import("@/lib/schemas");
const { COMPANY_BRIEF_SYSTEM, companyBriefPrompt } = await import("./companyBrief");

describe("companyBriefPrompt carries the subject", () => {
  test("the company reaches the model, labelled, with the role beside it", () => {
    const p = companyBriefPrompt("Zerodha", "Backend Engineer");
    expect(p).toContain("COMPANY: Zerodha");
    expect(p).toContain("ROLE: Backend Engineer");
    expect(p.indexOf("COMPANY:")).toBeLessThan(p.indexOf("ROLE:"));
  });

  test("a missing role is spelled out rather than left blank", () => {
    const p = companyBriefPrompt("Zerodha", null);
    expect(p).not.toContain("ROLE: \n");
    expect(p).toContain("not specified");
    expect(p).not.toContain("for a  role");
  });

  test("the company name is trimmed, so a pasted value does not shift the labels", () => {
    const p = companyBriefPrompt("  Zerodha \n", "  SRE  ");
    expect(p).toContain("COMPANY: Zerodha\n");
    expect(p).toContain("ROLE: SRE\n");
  });

  test("an over-long company or role is cut at the schema's own ceiling", () => {
    const long = `${"x".repeat(COMPANY_MAX_CHARS)}SENTINEL_TAIL`;
    expect(companyBriefPrompt(long, null)).not.toContain("SENTINEL_TAIL");
    expect(companyBriefPrompt("Zerodha", long)).not.toContain("SENTINEL_TAIL");
  });

  test("the returned JSON shape is spelled out with the exact keys", () => {
    const p = companyBriefPrompt("Zerodha", "SRE");
    for (const key of [
      "what_they_do",
      "recent_news",
      "headline",
      "date",
      "why_it_matters",
      "values",
      "interview_style_notes",
      "likely_questions",
      "questions_to_ask",
    ]) {
      expect(p).toContain(`"${key}"`);
    }
  });

  test("the counts the panel lays out are the counts the model is asked for", () => {
    const p = companyBriefPrompt("Zerodha", "SRE");
    expect(p).toContain("60 words");
    expect(p).toContain("3 to 5");
    expect(p).toContain("6 questions");
    expect(p).toContain("3 questions");
  });
});

describe("COMPANY_BRIEF_SYSTEM holds the line on invention", () => {
  test("it names the same keys the prompt asks for", () => {
    for (const key of [
      "what_they_do",
      "recent_news",
      "values",
      "interview_style_notes",
      "likely_questions",
      "questions_to_ask",
    ]) {
      expect(COMPANY_BRIEF_SYSTEM).toContain(`"${key}"`);
    }
  });

  test("it forbids invented news and prefers an empty list to a guess", () => {
    expect(COMPANY_BRIEF_SYSTEM).toContain("Never invent a headline");
    expect(COMPANY_BRIEF_SYSTEM).toContain("empty list");
    expect(COMPANY_BRIEF_SYSTEM).toContain("web search");
  });

  test("it asks for JSON only, since a grounded call cannot use JSON mode", () => {
    expect(COMPANY_BRIEF_SYSTEM).toContain("no code fences");
    expect(COMPANY_BRIEF_SYSTEM).toContain("no prose");
  });
});
