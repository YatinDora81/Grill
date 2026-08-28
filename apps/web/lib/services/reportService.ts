import "server-only";
import { after } from "next/server";
import type { Session, Turn } from "@repo/db";
import type { AcousticMetrics, AnswerScores, DeliveryMetrics, TranscriptWord } from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { ANSWER_CAP_MODEL } from "@/lib/interviewMeta";
import { REPORT_SYSTEM, reportPrompt, type ReportTurn } from "@/lib/prompts/report";
import { reportResponseSchema, type ReportResponse } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { getAudio } from "@/lib/storage/objectStore";
import { config } from "@/lib/env";
import { BAND_LABEL, scoreBand } from "@/components/ui";
import { PATTERN, isAnswerScores, worstDimension } from "@/lib/rubricPattern";
import { mailConfigured, sendMail } from "@/lib/mail/mailer";
import { renderReportReadyEmail } from "@/lib/mail/templates/reportReady";
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

async function turnAcoustics(t: Turn): Promise<AcousticMetrics | null> {
  if (!t.audioKey) return null;
  try {
    const audio = await getAudio(t.audioKey);
    const ext = t.audioKey.split(".").pop() || "webm";
    return await analyzeAcoustics(audio, `turn.${ext}`, `audio/${ext}`);
  } catch (err) {
    console.warn(`[reportService] acoustics failed for ${t.audioKey}: ${(err as Error).message}`);
    return null;
  }
}

export async function computeDelivery(turns: Turn[]): Promise<DeliveryMetrics> {
  const text = textDeliveryMetrics(
    turns.map((t) => ({ transcript: t.transcript, transcriptWords: words(t) })),
  );

  const acoustics: (AcousticMetrics | null)[] = new Array(turns.length).fill(null);
  if (config.storageConfigured) {
    let next = 0;
    const worker = async () => {
      while (next < turns.length) {
        const i = next++;
        acoustics[i] = await turnAcoustics(turns[i]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ANSWER_CAP_MODEL.concurrency, turns.length) }, worker),
    );
  }

  return combineDelivery(text, aggregateAcoustics(acoustics));
}

function honestLine(turns: Turn[], report: ReportResponse): string {
  const rubric = turns.flatMap((t) => {
    const s = scores(t);
    return isAnswerScores(s) ? [s] : [];
  });

  const worst = worstDimension(rubric);
  if (worst) return PATTERN[worst];

  const weakness = report.weaknesses[0]?.point?.trim();
  return weakness || report.verdict;
}

function queueReportReadyMail(session: Session, score: number, headline: string): void {
  if (!mailConfigured()) return;

  const send = async () => {
    try {
      const user = await repo.getUserById(session.userId);
      if (!user?.emailOnReport) return;
      await sendMail({
        to: user.email,
        ...renderReportReadyEmail({
          sessionName: session.name,
          score,
          band: BAND_LABEL[scoreBand(score)],
          headline,
          reportUrl: `${config.site.url}/report/${session.id}`,
          rematchUrl: `${config.site.url}/new?mode=weak_spots`,
        }),
      });
    } catch (err) {
      console.error(`[reportService] report-ready mail for ${session.id} failed:`, err);
    }
  };

  try {
    after(send);
  } catch (err) {
    console.error(`[reportService] could not defer report-ready mail for ${session.id}:`, err);
    void send();
  }
}

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

  const report = await repo.createReport({
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
    questionFeedback: value.question_feedback,
    raw: { report: value, raw_text: raw },
  });

  queueReportReadyMail(session, report.overallScore, honestLine(turns, value));

  return report;
}
