import "server-only";
import type { Session, Turn } from "@repo/db";
import type { AnswerScores, DeliveryMetrics, TranscriptWord } from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { REPORT_SYSTEM, reportPrompt, type ReportTurn } from "@/lib/prompts/report";
import { reportResponseSchema } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { getAudio } from "@/lib/storage/objectStore";
import { config } from "@/lib/env";
import {
  textDeliveryMetrics,
  analyzeAcoustics,
  aggregateAcoustics,
  combineDelivery,
} from "./deliveryService";
import { toSessionContext } from "./sessionContext";

function words(t: Turn): TranscriptWord[] | null {
  return (t.transcriptWords as TranscriptWord[] | null) ?? null;
}
function scores(t: Turn): AnswerScores | null {
  return (t.answerScores as AnswerScores | null) ?? null;
}

/** Delivery metrics for a session (text math + one-clip-at-a-time acoustics). */
export async function computeDelivery(turns: Turn[]): Promise<DeliveryMetrics> {
  const text = textDeliveryMetrics(
    turns.map((t) => ({ transcript: t.transcript, transcriptWords: words(t) })),
  );

  const acoustics: (Awaited<ReturnType<typeof analyzeAcoustics>>)[] = [];
  if (config.storageConfigured) {
    for (const t of turns) {
      if (!t.audioKey) {
        acoustics.push(null);
        continue;
      }
      try {
        const audio = await getAudio(t.audioKey);
        const ext = t.audioKey.split(".").pop() || "webm";
        acoustics.push(await analyzeAcoustics(audio, `turn.${ext}`, `audio/${ext}`));
      } catch (err) {
        console.warn(`[reportService] acoustics failed for ${t.audioKey}: ${(err as Error).message}`);
        acoustics.push(null);
      }
    }
  }

  return combineDelivery(text, aggregateAcoustics(acoustics));
}

/**
 * Build and persist the final report (Grill §end flow steps 1-5).
 * Caller owns the status guard + generating_report/completed/error transitions.
 */
export async function buildAndSaveReport(session: Session) {
  const turns = await repo.getTurns(session.id);
  const delivery = await computeDelivery(turns);

  const reportTurns: ReportTurn[] = turns.map((t) => ({
    turn_index: t.turnIndex,
    question: t.question,
    question_type: t.questionType,
    transcript: t.transcript ?? "",
    answer_scores: scores(t),
  }));

  const ctx = toSessionContext(session);
  const { value, raw } = await generateJson(reportResponseSchema, {
    system: REPORT_SYSTEM,
    prompt: reportPrompt(ctx, reportTurns, delivery),
    temperature: 0.4,
  });

  return repo.createReport({
    sessionId: session.id,
    overallScore: Math.round(value.overall_score),
    verdict: value.verdict,
    categoryScores: value.category_scores,
    deliveryMetrics: delivery,
    strengths: value.strengths,
    weaknesses: value.weaknesses,
    bestAnswer: value.best_answer,
    worstAnswer: value.worst_answer,
    nextSteps: value.next_steps,
    raw: { report: value, raw_text: raw },
  });
}
