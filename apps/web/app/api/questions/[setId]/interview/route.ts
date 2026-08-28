export const runtime = "nodejs";

import type { InterviewConfig, StartResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { setIdParamsSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { coerceDifficulty, perAnswerCapSeconds, setInterviewName } from "@/lib/interviewMeta";
import * as repo from "@/lib/db/repo";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { setId } = setIdParamsSchema.parse(await params);

    const set = await repo.getQuestionSet(setId, userId);
    if (!set) throw notFound("Question set not found.", "unknown_set");

    const items = await repo.getQuestionSetItems(setId);
    if (!items.length) {
      throw badRequest("That set has no questions to practise.", "empty_set");
    }

    const cap = perAnswerCapSeconds(items.length);
    if (cap === null) {
      throw badRequest(
        "That many questions can't be scored in time — this set is too large to run as an interview.",
        "too_many_questions",
      );
    }

    const difficulty = coerceDifficulty(set.difficulty);

    const config: InterviewConfig = {
      num_questions: items.length,
      difficulty,
      persona: "neutral",
      sources:
        set.source === "cultural" ? ["cultural"] : set.source === "topic" ? ["topic"] : ["resume"],
      mode: null,
      ...(set.source === "topic" ? { topic: set.sourceText } : {}),
      allow_repeats: false,
      max_answer_seconds: cap,
    };

    const session = await repo.createSession({
      userId,
      sourceType: "resume",
      sourceText: set.source === "resume" ? set.sourceText : "",
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
