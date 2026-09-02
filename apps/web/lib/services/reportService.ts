import "server-only";
import { after } from "next/server";
import type { Session, Turn } from "@repo/db";
import type {
  AcousticMetrics,
  AnswerScores,
  CodeSubmission,
  DeliveryMetrics,
  DesignReview,
  TranscriptWord,
} from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { ANSWER_CAP_MODEL } from "@/lib/interviewMeta";
import {
  REPORT_SYSTEM,
  reportPrompt,
  type ReportTurn,
  type ReportTurnCode,
  type ReportTurnDesign,
} from "@/lib/prompts/report";
import { reportResponseSchema, type ReportResponse } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { getAudio, presignGet } from "@/lib/storage/objectStore";
import { config } from "@/lib/env";
import { BAND_LABEL, scoreBand } from "@/components/ui";
import { PATTERN, isAnswerScores, worstDimension } from "@/lib/rubricPattern";
import { mailConfigured, sendMail } from "@/lib/mail/mailer";
import { renderReportReadyEmail } from "@/lib/mail/templates/reportReady";
import {
  textDeliveryMetrics,
  analyzeAcoustics,
  aggregateAcoustics,
  aggregateCamera,
  aggregateConfidence,
  aggregateLatency,
  combineDelivery,
  statementEnds,
  statementSpans,
} from "./deliveryService";
import { computeStarBreakdown } from "./starService";
import { seedDrillCards } from "./drillService";
import { spokenPart as codeSpokenPart } from "./codingService";
import { spokenPart as designSpokenPart } from "./designService";
import { toSessionContext } from "./sessionContext";

function words(t: Turn): TranscriptWord[] | null {
  return (t.transcriptWords as TranscriptWord[] | null) ?? null;
}
function scores(t: Turn): AnswerScores | null {
  return (t.answerScores as AnswerScores | null) ?? null;
}

const CODE_SOURCE_MAX_CHARS = 3_000;

function codeFacts(t: Turn): ReportTurnCode | null {
  const sub = (t.codeSubmission as CodeSubmission | null) ?? null;
  if (!sub) return null;
  return {
    language: sub.language,
    passed: sub.passed,
    total: sub.total,
    source: sub.source.slice(0, CODE_SOURCE_MAX_CHARS),
    think_aloud_pct: sub.think_aloud_pct,
    longest_silence_s: sub.longest_silence_s,
    first_edit_ms: sub.keystrokes.first_edit_ms,
    runs: sub.keystrokes.runs,
  };
}

const DESIGN_IMAGE_TTL_S = 3_600;

async function designFacts(t: Turn): Promise<ReportTurnDesign | null> {
  const review = (t.designReview as DesignReview | null) ?? null;
  if (!review) return null;

  let imageUrl: string | null = null;
  if (t.designImageKey && config.storageConfigured) {
    try {
      imageUrl = await presignGet(t.designImageKey, DESIGN_IMAGE_TTL_S);
    } catch (err) {
      console.warn(
        `[reportService] could not sign ${t.designImageKey}: ${(err as Error).message}`,
      );
    }
  }
  return { review, image_url: imageUrl };
}

function spokenTranscript(t: Turn): string | null {
  if (t.designReview) return designSpokenPart(t.transcript ?? "");
  if (t.codeSubmission) return codeSpokenPart(t.transcript ?? "");
  return t.transcript;
}

async function turnAcoustics(t: Turn): Promise<AcousticMetrics | null> {
  if (!t.audioKey) return null;
  try {
    const audio = await getAudio(t.audioKey);
    const ext = t.audioKey.split(".").pop() || "webm";
    return await analyzeAcoustics(
      audio,
      `turn.${ext}`,
      `audio/${ext}`,
      statementEnds(words(t)),
      statementSpans(words(t)),
    );
  } catch (err) {
    console.warn(`[reportService] acoustics failed for ${t.audioKey}: ${(err as Error).message}`);
    return null;
  }
}

export async function computeDelivery(turns: Turn[]): Promise<DeliveryMetrics> {
  const text = textDeliveryMetrics(
    turns.map((t) => ({ transcript: spokenTranscript(t), transcriptWords: words(t) })),
  );

  const acoustics: (AcousticMetrics | null)[] = new Array(turns.length).fill(null);
  if (config.storageConfigured) {
    let next = 0;
    const worker = async () => {
      while (next < turns.length) {
        const i = next++;
        if (turns[i]!.codeSubmission || turns[i]!.designReview) {
          acoustics[i] = null;
          continue;
        }
        acoustics[i] = await turnAcoustics(turns[i]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ANSWER_CAP_MODEL.concurrency, turns.length) }, worker),
    );
  }

  const latency = aggregateLatency(
    turns.map((t) => ({
      responseLatencyMs: t.codeSubmission || t.designReview ? null : t.responseLatencyMs,
      interruptedAtS: t.interruptedAtS,
    })),
  );

  return combineDelivery(text, aggregateAcoustics(acoustics), aggregateCamera(turns), {
    ...latency,
    transcriber_confidence: aggregateConfidence(turns),
  });
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

  const [delivery, starBreakdown] = await Promise.all([
    computeDelivery(turns),
    computeStarBreakdown(turns),
  ]);

  const reportTurns: ReportTurn[] = await Promise.all(
    turns.map(async (t) => ({
      turn_index: t.turnIndex,
      question: t.question,
      question_type: t.questionType,
      transcript: t.transcript ?? "",
      answer_scores: scores(t),
      code: codeFacts(t),
      design: await designFacts(t),
    })),
  );

  const ctx = toSessionContext(session);
  const { value, raw } = await generateJson(reportResponseSchema, {
    system: REPORT_SYSTEM,
    prompt: reportPrompt(ctx, reportTurns, delivery, starBreakdown),
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
    starBreakdown,
    raw: { report: value, raw_text: raw },
  });

  await seedDrillCards(session.userId, turns).catch((err) =>
    console.warn(`[reportService] drill seeding for ${session.id} skipped:`, err),
  );

  queueReportReadyMail(session, report.overallScore, honestLine(turns, value));

  return report;
}
