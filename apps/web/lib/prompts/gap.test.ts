import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const { GAP_JD_MAX_CHARS, GAP_RESUME_MAX_CHARS } = await import("@/lib/schemas");
const { RESUME_GAP_SYSTEM, resumeGapPrompt } = await import("./gap");

const JD = "Senior Backend Engineer. 3+ yrs React and TypeScript. Postgres at scale. On-call.";
const RESUME = "Yatin Dora. Built Grill — Next.js 16, React 19, TypeScript. Prisma 7 on Postgres.";

describe("resumeGapPrompt carries both documents", () => {
  test("the job description and the résumé both reach the model, labelled", () => {
    const p = resumeGapPrompt({ jd: JD, resumeText: RESUME });
    expect(p).toContain("JOB DESCRIPTION:");
    expect(p).toContain(JD);
    expect(p).toContain("RÉSUMÉ:");
    expect(p).toContain(RESUME);
    expect(p.indexOf("JOB DESCRIPTION:")).toBeLessThan(p.indexOf("RÉSUMÉ:"));
  });

  test("both inputs are trimmed, so a pasted document's leading blank lines don't shift the labels", () => {
    const p = resumeGapPrompt({ jd: `\n\n  ${JD}  \n`, resumeText: `\n${RESUME}\n\n` });
    expect(p).toContain(`JOB DESCRIPTION:\n${JD}\n`);
    expect(p).toContain(`RÉSUMÉ:\n${RESUME}\n`);
  });

  test("the returned JSON shape is spelled out with the exact keys", () => {
    const p = resumeGapPrompt({ jd: JD, resumeText: RESUME });
    for (const key of [
      "match_percent",
      "summary",
      "covered",
      "requirement",
      "evidence",
      "gaps",
      "why_it_matters",
      "how_to_close",
    ]) {
      expect(p).toContain(`"${key}"`);
    }
  });
});

describe("the caps actually truncate", () => {
  const long = (n: number) => "x".repeat(n);
  const overflow = (max: number) => `${long(max)}SENTINEL_TAIL`;

  test("a job description past the cap is cut at the cap and says so", () => {
    const p = resumeGapPrompt({ jd: overflow(GAP_JD_MAX_CHARS), resumeText: RESUME });
    expect(p).not.toContain("SENTINEL_TAIL");
    expect(p).toContain("cut off here");
    expect(p).toContain("posting");
  });

  test("a résumé past the cap is cut at the cap and says so", () => {
    const p = resumeGapPrompt({ jd: JD, resumeText: overflow(GAP_RESUME_MAX_CHARS) });
    expect(p).not.toContain("SENTINEL_TAIL");
    expect(p).toContain("cut off here");
    expect(p).toContain("résumé is longer");
  });

  test("neither document contributes more than its cap in characters", () => {
    const p = resumeGapPrompt({
      jd: long(GAP_JD_MAX_CHARS * 3),
      resumeText: long(GAP_RESUME_MAX_CHARS * 3),
    });
    const xs = (p.match(/x+/g) ?? []).map((run) => run.length);
    expect(xs).toEqual([GAP_JD_MAX_CHARS, GAP_RESUME_MAX_CHARS]);
  });

  test("a document exactly at the cap is passed through whole, with no truncation note", () => {
    const p = resumeGapPrompt({ jd: long(GAP_JD_MAX_CHARS), resumeText: RESUME });
    expect(p).not.toContain("cut off here");
    expect(p).toContain(long(GAP_JD_MAX_CHARS));
  });
});

describe("the never-invent-evidence rule is in the system prompt", () => {
  test("evidence must be quoted or closely paraphrased from the résumé", () => {
    expect(RESUME_GAP_SYSTEM).toContain("quote or closely paraphrase");
    expect(RESUME_GAP_SYSTEM).toContain("Never invent experience");
  });

  test("an unverifiable requirement is stated to be a gap", () => {
    expect(RESUME_GAP_SYSTEM).toMatch(/cannot be verified from the résumé, it is a GAP/);
  });

  test("JSON only — no prose, no code fences", () => {
    expect(RESUME_GAP_SYSTEM).toContain("no prose, no code fences");
    expect(RESUME_GAP_SYSTEM).toContain("ONLY a single JSON object");
  });

  test("the system prompt names every schema key, so JSON mode can't invent its own", () => {
    for (const key of [
      "match_percent",
      "summary",
      "covered",
      "requirement",
      "evidence",
      "gaps",
      "why_it_matters",
      "how_to_close",
    ]) {
      expect(RESUME_GAP_SYSTEM).toContain(`"${key}"`);
    }
  });
});
