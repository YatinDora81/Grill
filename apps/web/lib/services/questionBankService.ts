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

/**
 * One model call generates at most this many. Past ~10 the tail of a batch
 * goes soft — the model starts padding with the stock questions the quality
 * bar bans — and a longer JSON array is likelier to arrive truncated. Larger
 * sets are built as consecutive chunks, each banning everything before it.
 */
const CHUNK_SIZE = 10;

/**
 * Extra calls allowed on top of the minimum, to replace duplicates and
 * malformed items. Chunks that come back short are common (the dedupe filter
 * eats near-rephrasings), a set that comes back short after this many is a
 * provider having a bad day — stop and say so rather than looping on it.
 */
const MAX_EXTRA_CALLS = 3;

/**
 * Generate exactly `count` distinct questions for a set.
 *
 * Distinct means distinct under `questionHash` — the same normalisation that
 * dedupes stars — so "What broke first?" and "what broke  first" are one
 * question. The whole batch is generated here, before anything is persisted:
 * a set is a document, and a document half-written by a failed provider call
 * is worse than no document, so the caller only ever stores a complete one.
 *
 * DELIBERATELY reads nothing per-user: the bank is independent of interview
 * history by design (a set is a syllabus, not a session), so unlike the
 * interview's questionInputs there is no asked-before list here. The only
 * repeats being fought are repeats *within the set*.
 */
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
    // Not a 500: the app did its job, the provider kept returning rephrasings
    // or short arrays. Same register as the key-pool exhaustion message.
    throw serviceUnavailable(
      `Could only generate ${out.length} of ${count} distinct questions right now — try again shortly, or ask for fewer.`,
      "generation_short",
    );
  }
  return out;
}

// ── DTO mapping ───────────────────────────────────────────────────
// The API speaks snake_case contracts; the DB rows are camelCase and store
// difficulty as text. Mapped in one place so the list route, the detail route
// and the generate route can never disagree about what a set looks like.

/** The columns every mapper needs — structural, so any Prisma selection fits. */
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
    // The items are the truth of how many questions exist; the stored `count`
    // column is only what was asked for.
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
