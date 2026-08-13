export const runtime = "nodejs";

import type { InterviewConfig, StartResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { setIdParamsSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { coerceDifficulty, perAnswerCapSeconds, setInterviewName } from "@/lib/interviewMeta";
import * as repo from "@/lib/db/repo";

/**
 * Run an interview on a question set — the ONE bridge between the bank and
 * the interview world, crossable any number of times, in one direction only.
 *
 * Nothing is generated here; that's the point, and it's the retry mechanism
 * verbatim. The set's items are copied into brand-new Turn rows up front, the
 * session carries `questionSetId`, and the answer loop (answerService) serves
 * those turns in order without ever calling the model for a question. The set
 * itself is never touched: delete it tomorrow and today's interview, its
 * transcript and its report are all still whole.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { setId } = setIdParamsSchema.parse(await params);

    // User-scoped: someone else's set id is simply "not found".
    const set = await repo.getQuestionSet(setId, userId);
    if (!set) throw notFound("Question set not found.", "unknown_set");

    const items = await repo.getQuestionSetItems(setId);
    if (!items.length) {
      throw badRequest("That set has no questions to practise.", "empty_set");
    }

    // QUESTION_SET_BOUNDS keeps every set inside this cap by construction,
    // but the cap is derived here and nowhere else (same as /start) — a set
    // written by some future migration must be refused, not run unscorable.
    const cap = perAnswerCapSeconds(items.length);
    if (cap === null) {
      throw badRequest(
        "That many questions can't be scored in time — this set is too large to run as an interview.",
        "too_many_questions",
      );
    }

    const difficulty = coerceDifficulty(set.difficulty);

    /**
     * A config the stored-config schema accepts, because everything that later
     * touches this session (the room, the report, toSessionContext) parses it.
     * The sources mirror the set's own source so the report is briefed on the
     * right kind of interview; they never drive question GENERATION here —
     * every turn is pre-seeded.
     */
    const config: InterviewConfig = {
      num_questions: items.length,
      difficulty,
      persona: "neutral",
      sources:
        set.source === "cultural" ? ["cultural"] : set.source === "topic" ? ["topic"] : ["resume"],
      mode: null,
      // The topic source's superRefine demands the topic text; the set stored
      // it (bounded to 2 000 chars at set creation).
      ...(set.source === "topic" ? { topic: set.sourceText } : {}),
      allow_repeats: false,
      max_answer_seconds: cap,
    };

    const session = await repo.createSession({
      userId,
      sourceType: "resume",
      // The résumé the questions were generated from, so the report grounds in
      // the same material. Topic/cultural sets never had one — empty is legal,
      // exactly as it is for a project interview.
      sourceText: set.source === "resume" ? set.sourceText : "",
      // Derived, never asked for — running a set is one button on the set
      // page, and `takeNumber` keeps the runs tellable-apart on the dashboard.
      name: setInterviewName(set.name, set._count.sessions + 1),
      role: set.role,
      config,
      questionSetId: set.id,
    });

    await repo.copySetQuestionsInto(session.id, set.id);

    const first = items[0]!;
    return json({
      session_id: session.id,
      turn_index: 0,
      question: first.question,
      question_type: first.questionType,
    } satisfies StartResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
