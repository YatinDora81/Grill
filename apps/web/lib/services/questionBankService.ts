import "server-only";
import type {
  QuestionSetDetail,
  QuestionSetItemDTO,
  QuestionSetSource,
  QuestionSetSummary,
  QuestionType,
} from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { serviceUnavailable } from "@/lib/errors";
import { coerceDifficulty } from "@/lib/interviewMeta";
import { questionHash } from "@/lib/db/repo";
import {
  questionBankPrompt,
  questionBankSystem,
  type QuestionBankContext,
} from "@/lib/prompts/questionBank";
import { questionBatchResponseSchema } from "@/lib/schemas";

export interface GeneratedQuestion {
  question: string;
  questionType: QuestionType;
}

const CHUNK_SIZE = 10;

const MAX_EXTRA_CALLS = 3;

export async function generateQuestionSet(
  ctx: QuestionBankContext,
  count: number,
): Promise<GeneratedQuestion[]> {
  const out: GeneratedQuestion[] = [];
  const seen = new Set<string>();

  const minCalls = Math.ceil(count / CHUNK_SIZE);
  const maxCalls = minCalls + MAX_EXTRA_CALLS;

  for (let call = 0; call < maxCalls && out.length < count; call++) {
    const want = Math.min(CHUNK_SIZE, count - out.length);
    const { value } = await generateJson(questionBatchResponseSchema, {
      system: questionBankSystem(ctx.source),
      prompt: questionBankPrompt(
        ctx,
        want,
        out.map((q) => q.question),
      ),
      temperature: 0.8,
    });

    for (const q of value.questions) {
      if (out.length >= count) break;
      const hash = questionHash(q.question);
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ question: q.question, questionType: q.question_type });
    }
  }

  if (out.length < count) {
    throw serviceUnavailable(
      `Could only generate ${out.length} of ${count} distinct questions right now — try again shortly, or ask for fewer.`,
      "generation_short",
    );
  }
  return out;
}

interface SetRow {
  id: string;
  name: string;
  source: QuestionSetSource;
  role: string | null;
  difficulty: string;
  createdAt: Date;
}

export function toSetSummary(
  row: SetRow,
  counts: { items: number; sessions: number },
): QuestionSetSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    role: row.role,
    difficulty: coerceDifficulty(row.difficulty),
    count: counts.items,
    created_at: row.createdAt.toISOString(),
    times_practised: counts.sessions,
  };
}

export function toSetDetail(
  row: SetRow,
  items: QuestionSetItemDTO[],
  sessions: number,
): QuestionSetDetail {
  return { ...toSetSummary(row, { items: items.length, sessions }), items };
}

export function toItemDTO(item: {
  itemIndex: number;
  question: string;
  questionType: QuestionType;
}): QuestionSetItemDTO {
  return {
    item_index: item.itemIndex,
    question: item.question,
    question_type: item.questionType,
  };
}
