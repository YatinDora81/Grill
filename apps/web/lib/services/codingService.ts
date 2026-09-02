import "server-only";
import type { Turn } from "@repo/db";
import type {
  AnswerScores,
  CodeSubmission,
  CodingQuestionPayload,
  QuestionType,
  TranscriptWord,
  TurnPayload,
} from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import {
  answerScoresSchema,
  codingQuestionSchema,
  questionResponseSchema,
  readTurnPayload,
  type CodeAnswerPayload,
} from "@/lib/schemas";
import {
  questionSystem,
  type QuestionInputs,
  type SessionContext,
} from "@/lib/prompts/questionGen";
import {
  CODE_REVIEW_SYSTEM,
  CODING_SYSTEM,
  codeFollowUpPrompt,
  codeReviewPrompt,
  codingQuestionPrompt,
} from "@/lib/prompts/codingQuestion";
import { questionInputs } from "./questionService";

export const CODING_ANSWER_CAP_S = 1_200;
export const DESIGN_ANSWER_CAP_S = 900;

const QUESTION_TEXT_MAX = 4_000;
const SPEECH_MERGE_GAP_S = 1.0;
const SPOKEN_MARKER = "Spoken while coding:";

export interface PlannedTurn {
  question: string;
  questionType: QuestionType;
  payload: TurnPayload | null;
}

export function turnsFor(problems: number): number {
  return Math.max(1, problems) * 2;
}

export function questionTextFor(p: { title: string; prompt_markdown: string }): string {
  return `${p.title}\n\n${p.prompt_markdown}`.slice(0, QUESTION_TEXT_MAX);
}

export function payloadOf(t: Pick<Turn, "questionPayload">): TurnPayload | null {
  return readTurnPayload(t.questionPayload);
}

export function spokenPart(transcript: string): string {
  const i = transcript.lastIndexOf(SPOKEN_MARKER);
  return i === -1 ? "" : transcript.slice(i + SPOKEN_MARKER.length).trim();
}

export async function generateCodingQuestion(
  ctx: SessionContext,
  inputs: QuestionInputs,
  index: number,
  total: number,
): Promise<CodingQuestionPayload> {
  const { value } = await generateJson(codingQuestionSchema, {
    system: CODING_SYSTEM,
    prompt: codingQuestionPrompt(ctx, inputs, index, total),
    temperature: 0.7,
  });
  return value;
}

export function spokenSeconds(words: TranscriptWord[] | null | undefined): {
  spoken: number;
  longestGap: number;
  lastEnd: number;
} {
  if (!words?.length) return { spoken: 0, longestGap: 0, lastEnd: 0 };
  let spoken = 0;
  let longestGap = words[0]!.start;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    spoken += Math.max(0, w.end - w.start);
    if (i > 0) {
      const gap = w.start - words[i - 1]!.end;
      if (gap > 0 && gap <= SPEECH_MERGE_GAP_S) spoken += gap;
      if (gap > longestGap) longestGap = gap;
    }
  }
  return { spoken, longestGap, lastEnd: words[words.length - 1]!.end };
}

export function buildSubmission(
  payload: CodeAnswerPayload,
  words: TranscriptWord[] | null | undefined,
): CodeSubmission {
  const turnS = Math.max(1, payload.keystrokes.submitted_at_ms / 1_000);
  const { spoken, longestGap, lastEnd } = spokenSeconds(words);
  const tailGap = Math.max(0, turnS - lastEnd);
  const passed = payload.results.filter((r) => r.passed).length;
  return {
    language: payload.language,
    source: payload.source,
    results: payload.results,
    passed,
    total: payload.results.length,
    keystrokes: payload.keystrokes,
    think_aloud_pct: words?.length
      ? Math.round(Math.min(100, (spoken / turnS) * 100) * 10) / 10
      : null,
    longest_silence_s: words?.length ? Math.round(Math.max(longestGap, tailGap) * 10) / 10 : null,
  };
}

export function codeTranscript(sub: CodeSubmission, spoken: string): string {
  return [
    `[${sub.language}] ${sub.passed}/${sub.total} tests passed`,
    "```",
    sub.source.slice(0, 12_000),
    "```",
    spoken.trim() ? `${SPOKEN_MARKER} ${spoken.trim()}` : `${SPOKEN_MARKER} (nothing)`,
  ].join("\n");
}

export async function scoreCode(
  q: CodingQuestionPayload,
  sub: CodeSubmission,
  spoken: string,
): Promise<AnswerScores> {
  const { value } = await generateJson(answerScoresSchema, {
    system: CODE_REVIEW_SYSTEM,
    prompt: codeReviewPrompt(q, sub, spoken),
    temperature: 0.2,
  });
  return value;
}

export async function planNextCodingTurn(
  ctx: SessionContext,
  turns: Turn[],
  userId: string,
): Promise<PlannedTurn | null> {
  const problems = ctx.config.problems ?? 2;
  const answered = turns.filter((t) => t.transcript !== null);
  const last = answered[answered.length - 1];
  const lastPayload = last ? payloadOf(last) : null;

  if (last && lastPayload?.kind === "coding") {
    const sub = (last.codeSubmission as CodeSubmission | null) ?? null;
    const spoken = spokenPart(last.transcript ?? "");
    const { value } = await generateJson(questionResponseSchema, {
      system: questionSystem(ctx.config),
      prompt: codeFollowUpPrompt(lastPayload, sub, spoken),
      temperature: 0.7,
    });
    return { question: value.question, questionType: "followup", payload: null };
  }

  const asked = turns.filter((t) => payloadOf(t)?.kind === "coding").length;
  if (asked >= problems) return null;

  const payload = await generateCodingQuestion(
    ctx,
    await questionInputs(ctx, userId),
    asked,
    problems,
  );
  return { question: questionTextFor(payload), questionType: "technical", payload };
}
