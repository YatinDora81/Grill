import { describe, expect, test } from "bun:test";
import type { DesignQuestionPayload, InterviewConfig } from "@repo/types";
import { DIFFICULTY_META } from "@/lib/interviewMeta";
import {
  DESIGN_REVIEW_SYSTEM,
  DESIGN_SYSTEM,
  designQuestionPrompt,
  designReviewPrompt,
} from "./designQuestion";
import type { SessionContext } from "./questionGen";

function ctx(config: Partial<InterviewConfig> = {}): SessionContext {
  return {
    sourceType: "resume",
    sourceText: "Staff engineer. Shipped a billing ledger on Postgres.",
    role: "Backend Engineer",
    config: {
      num_questions: 4,
      difficulty: "hard",
      sources: ["resume"],
      mode: null,
      allow_repeats: false,
      round: "design",
      problems: 2,
      ...config,
    },
  };
}

const PROMPT: DesignQuestionPayload = {
  kind: "design",
  title: "A ledger for the till",
  prompt_markdown: "Design the write path for a point-of-sale ledger.",
  requirements: ["every sale is durable", "reads within one second"],
  scale: "2M daily users, 8k writes/s",
  focus: ["partitioning", "failure handling"],
};

describe("the prompt that asks for a design", () => {
  test("carries the difficulty pitch and the candidate's own material", () => {
    const p = designQuestionPrompt(ctx(), { askedBefore: [] }, 0, 2);

    expect(p).toContain(DIFFICULTY_META.hard.pitch);
    expect(p).toContain("Design prompt 1 of 2");
    expect(p).toContain("Shipped a billing ledger on Postgres");
    expect(p).toContain("Backend Engineer");
  });

  test("lists what was already asked so the second prompt is a different system", () => {
    const p = designQuestionPrompt(ctx(), { askedBefore: ["A ledger for the till"] }, 1, 2);

    expect(p).toContain("Do not repeat these prompts");
    expect(p).toContain("- A ledger for the till");
  });

  test("says nothing about an architecture, so the model cannot leak the answer", () => {
    expect(DESIGN_SYSTEM).toContain("Never sketch the answer");
    expect(DESIGN_SYSTEM).toContain("JSON only");
  });
});

describe("the prompt that reviews a board", () => {
  test("puts the requirements, the scale and the spoken tail in front of the model", () => {
    const p = designReviewPrompt(PROMPT, "  I sharded the ledger by store.  ");

    expect(p).toContain("- every sale is durable");
    expect(p).toContain("Scale: 2M daily users, 8k writes/s");
    expect(p).toContain("Focus areas: partitioning, failure handling");
    expect(p).toContain("I sharded the ledger by store.");
  });

  test("a silent board is said to be silent rather than left blank", () => {
    expect(designReviewPrompt(PROMPT, "   ")).toContain("(said nothing)");
  });

  test("the reviewer is told not to invent what it cannot see", () => {
    expect(DESIGN_REVIEW_SYSTEM).toContain("never invent components");
    expect(DESIGN_REVIEW_SYSTEM).toContain("JSON only");
  });
});
