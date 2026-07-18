import { describe, expect, test } from "bun:test";
import { PROJECT_DIGEST_SYSTEM, projectDigestSchema, renderDigest } from "./projectDigest";

/**
 * Gemini in JSON mode does not honour "this field is a string" — it will return
 * a nested object or an array where the schema asks for a string. Before the
 * coercion these parses failed, which cost a retry and, on repeat, dead-ended the
 * whole repo import to the raw-dump fallback. These pin the tolerance.
 */
describe("projectDigestSchema tolerates the shapes Gemini actually emits", () => {
  test("coerces an object in a string field into a string", () => {
    const r = projectDigestSchema.safeParse({
      summary: "A URL shortener.",
      architecture: { layers: ["api", "db"], flow: "req → api → pg" },
      data_and_apis: { models: ["Link"], endpoints: ["POST /shorten"] },
    });
    expect(r.success).toBe(true);
    expect(typeof r.data!.architecture).toBe("string");
    expect(r.data!.architecture).toContain("layers");
    expect(typeof r.data!.data_and_apis).toBe("string");
  });

  test("coerces non-string array elements, and wraps a scalar into an array", () => {
    const r = projectDigestSchema.safeParse({
      summary: "x",
      tech_stack: ["TypeScript", { name: "Postgres", version: 16 }],
      notable_decisions: "single string, not an array",
    });
    expect(r.success).toBe(true);
    expect(r.data!.tech_stack).toHaveLength(2);
    expect(r.data!.tech_stack.every((s) => typeof s === "string")).toBe(true);
    expect(r.data!.notable_decisions).toEqual(["single string, not an array"]);
  });

  test("still fills sensible defaults for omitted fields", () => {
    const r = projectDigestSchema.safeParse({ summary: "only a summary" });
    expect(r.success).toBe(true);
    expect(r.data!.tech_stack).toEqual([]);
    expect(r.data!.architecture).toBe("");
    expect(r.data!.question_seeds).toEqual([]);
  });

  test("accepts a blank or missing summary rather than rejecting the whole digest", () => {
    // The service backfills a blank summary from metadata; rejecting here would
    // throw away an otherwise-good digest (and, post map phase, a lot of work).
    const blank = projectDigestSchema.safeParse({ summary: "", tech_stack: ["TS"] });
    expect(blank.success).toBe(true);
    expect(blank.data!.summary).toBe("");

    const missing = projectDigestSchema.safeParse({ tech_stack: ["TS"] });
    expect(missing.success).toBe(true);
    expect(missing.data!.summary).toBe("");
  });

  test("the digest system prompt spells out every schema key", () => {
    // The prompt's exact-key list is the ONLY guard against Gemini inventing its
    // own key names (project_overview, flagged_items, …) that then strip to an
    // empty digest — coercion only fixes wrong TYPES of correctly-named keys.
    for (const key of [
      "summary",
      "tech_stack",
      "architecture",
      "key_features",
      "data_and_apis",
      "notable_decisions",
      "risks_and_gaps",
      "question_seeds",
    ]) {
      expect(PROJECT_DIGEST_SYSTEM).toContain(`"${key}"`);
    }
  });

  test("a coerced digest renders to labelled text without throwing", () => {
    const digest = projectDigestSchema.parse({
      summary: "A build tool.",
      architecture: { note: "modular" },
      tech_stack: [{ x: 1 }],
    });
    const text = renderDigest(digest, "Note: partial import.");
    expect(text).toContain("Note: partial import.");
    expect(text).toContain("Summary:");
    expect(text).toContain("A build tool.");
  });
});
