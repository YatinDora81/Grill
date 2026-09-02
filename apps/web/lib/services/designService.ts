import "server-only";
import type { Turn } from "@repo/db";
import type { AnswerScores, DesignQuestionPayload, DesignReview } from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { designQuestionSchema, designReviewResponseSchema } from "@/lib/schemas";
import type { QuestionInputs, SessionContext } from "@/lib/prompts/questionGen";
import {
  DESIGN_REVIEW_SYSTEM,
  DESIGN_SYSTEM,
  designQuestionPrompt,
  designReviewPrompt,
} from "@/lib/prompts/designQuestion";
import { payloadOf, questionTextFor, type PlannedTurn } from "./codingService";
import { questionInputs } from "./questionService";

const SPOKEN_MARKER = "Spoken:";

export async function generateDesignQuestion(
  ctx: SessionContext,
  inputs: QuestionInputs,
  index: number,
  total: number,
): Promise<DesignQuestionPayload> {
  const { value } = await generateJson(designQuestionSchema, {
    system: DESIGN_SYSTEM,
    prompt: designQuestionPrompt(ctx, inputs, index, total),
    temperature: 0.7,
  });
  return value;
}

export async function firstDesignTurn(
  ctx: SessionContext,
  inputs: QuestionInputs,
): Promise<{ question: string; question_type: "technical"; payload: DesignQuestionPayload }> {
  const payload = await generateDesignQuestion(ctx, inputs, 0, ctx.config.problems ?? 2);
  return { question: questionTextFor(payload), question_type: "technical", payload };
}

export async function reviewDesign(
  q: DesignQuestionPayload,
  png: Uint8Array,
  spoken: string,
): Promise<{ review: DesignReview; scores: AnswerScores }> {
  const { value } = await generateJson(designReviewResponseSchema, {
    system: DESIGN_REVIEW_SYSTEM,
    prompt: designReviewPrompt(q, spoken),
    images: [{ mimeType: "image/png", data: Buffer.from(png).toString("base64") }],
    temperature: 0.2,
  });
  const { scores, ...review } = value;
  return { review, scores };
}

export function designTranscript(review: DesignReview, spoken: string): string {
  const list = (items: string[]) => (items.length ? items.join(", ") : "none");
  return [
    `[design] components: ${list(review.components)} | missing: ${list(review.missing)}` +
      ` | SPOF: ${list(review.single_points_of_failure)}`,
    spoken.trim() ? `${SPOKEN_MARKER} ${spoken.trim()}` : `${SPOKEN_MARKER} (nothing)`,
  ].join("\n");
}

export function spokenPart(transcript: string): string {
  const i = transcript.lastIndexOf(SPOKEN_MARKER);
  return i === -1 ? "" : transcript.slice(i + SPOKEN_MARKER.length).trim();
}

function scaleFollowUp(q: DesignQuestionPayload): string {
  const scale = q.scale.trim();
  return `Walk me through what happens when ${scale || "the load you were given"} doubles.`;
}

export async function planNextDesignTurn(
  ctx: SessionContext,
  turns: Turn[],
  userId: string,
): Promise<PlannedTurn | null> {
  const problems = ctx.config.problems ?? 2;
  const answered = turns.filter((t) => t.transcript !== null);
  const last = answered[answered.length - 1];
  const lastPayload = last ? payloadOf(last) : null;

  if (last && lastPayload?.kind === "design") {
    const review = (last.designReview as DesignReview | null) ?? null;
    const asked = review?.follow_up_question?.trim() || scaleFollowUp(lastPayload);
    return { question: asked, questionType: "followup", payload: null };
  }

  const asked = turns.filter((t) => payloadOf(t)?.kind === "design").length;
  if (asked >= problems) return null;

  const payload = await generateDesignQuestion(
    ctx,
    await questionInputs(ctx, userId),
    asked,
    problems,
  );
  return { question: questionTextFor(payload), questionType: "technical", payload };
}
