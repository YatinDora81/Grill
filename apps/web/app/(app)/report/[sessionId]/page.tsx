import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Report as ReportDTO } from "@repo/types";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos } from "@/lib/services/videoService";
import { ButtonLink, Card, ScoreMeter, cx, scoreTone } from "@/components/ui";
import { DeleteInterviewButton } from "./DeleteInterviewButton";
import { Delivery } from "./Delivery";
import { FinishReport } from "./FinishReport";
import { PlayAnswer } from "./PlayAnswer";
import { Progress } from "./Progress";
import { Replay } from "./Replay";
import { RetryButton } from "./RetryButton";

export const metadata: Metadata = {
  title: "Report",
  description: "Scores, per-question feedback and delivery for this interview.",
};
export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ finish?: string }>;
}) {
  const { sessionId } = await params;
  const { finish } = await searchParams;

  const userId = await getUserId();
  if (!userId) redirect(`/login?next=/report/${sessionId}`);

  const session = await repo.getSession(sessionId, userId);
  if (!session) redirect("/dashboard");

  const row = await repo.getReportForUser(sessionId, userId);
  if (!row) {
    // No report yet. If the interview is actually finished (every question
    // answered, or a build that died), /end is retryable — let the user trigger
    // it rather than stranding them on a dead page.
    const retryable =
      session.status === "in_progress" ||
      session.status === "generating_report" ||
      session.status === "error" ||
      finish === "1";
    if (!retryable) redirect("/dashboard");
    return <FinishReport sessionId={sessionId} />;
  }

  const report: ReportDTO = {
    id: row.id,
    session_id: row.sessionId,
    overall_score: row.overallScore,
    verdict: row.verdict,
    category_scores: row.categoryScores as unknown as ReportDTO["category_scores"],
    delivery_metrics: row.deliveryMetrics as unknown as ReportDTO["delivery_metrics"],
    strengths: row.strengths as unknown as ReportDTO["strengths"],
    weaknesses: row.weaknesses as unknown as ReportDTO["weaknesses"],
    best_answer: row.bestAnswer as unknown as ReportDTO["best_answer"],
    worst_answer: row.worstAnswer as unknown as ReportDTO["worst_answer"],
    next_steps: row.nextSteps as unknown as ReportDTO["next_steps"],
    question_feedback: (row.questionFeedback as unknown as ReportDTO["question_feedback"]) ?? [],
    created_at: row.createdAt.toISOString(),
  };

  const feedbackByTurn = new Map(
    report.question_feedback.map((f) => [f.turn_index, f] as const),
  );

  // Which turns were spoken — a typed answer has nothing to play back.
  const turns = await repo.getTurns(sessionId);

  // Reaching here means a report exists, which means the interview is over —
  // so no upload of this session's can still be live, and settling one is safe.
  // claimAndBuild already did this before the report was built; repeating it is
  // the retry for the case where that attempt hit a transient R2 error, since
  // the gate below would otherwise hide such a recording forever with nothing
  // left to trigger a salvage. A no-op (one indexed read) in the normal case.
  await settleUnfinishedVideos(sessionId).catch(() => {
    /* best-effort: a report must still render when housekeeping fails */
  });

  // Turn.videoId is stamped when the answer is given, long before the upload is
  // stitched — it says which recording the answer is in, never that the object
  // exists. Offering "Watch" straight off it hands out a button whose only
  // possible outcome is a 409, so gate on the recordings that are actually
  // playable.
  const playableVideoIds = new Set((await repo.listSessionVideos(sessionId)).map((v) => v.id));
  // One query for the whole replay rather than one per turn: a 100-question
  // report would otherwise open 100 connections to paint 100 star icons.
  const starredHashes = await repo.starredHashesFor(
    userId,
    turns.map((t) => t.question),
  );
  const audioTurns = new Set(turns.filter((t) => t.audioKey).map((t) => t.turnIndex));

  // If this run retried an earlier one, the questions were identical — so the
  // two scores are directly comparable. Only worth showing once the parent has
  // a report of its own to compare against.
  const parent = await repo.getRetryParent(session, userId);
  const before = parent?.report;

  const tone = scoreTone(report.overall_score);
  const toneText = { strong: "text-strong", mixed: "text-mixed", weak: "text-weak" }[tone];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
        ← Dashboard
      </Link>

      {/* Hero: the number they came for, and the verdict in plain words. */}
      <header className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink-muted">
            {[session.name?.trim() || session.role?.trim() || "Interview"]
              // The role only earns a slot once the name isn't already it.
              .concat(session.name?.trim() && session.role?.trim() ? [session.role.trim()] : [])
              .concat(report.created_at.slice(0, 10))
              .join(" · ")}
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight tracking-tight">
            {report.verdict}
          </h1>
        </div>
        <div className="text-right">
          <p className={cx("tabular font-display text-6xl leading-none", toneText)}>
            {report.overall_score}
          </p>
          <p className="mt-1 text-xs text-ink-muted">out of 100</p>
        </div>
      </header>

      {before ? (
        <Progress
          now={{
            overall: report.overall_score,
            technical: report.category_scores.technical,
            communication: report.category_scores.communication,
            problem_solving: report.category_scores.problem_solving,
          }}
          before={{
            overall: before.overallScore,
            ...(before.categoryScores as unknown as {
              technical: number;
              communication: number;
              problem_solving: number;
            }),
          }}
          beforeSessionId={before.sessionId}
          beforeDate={before.createdAt.toISOString().slice(0, 10)}
        />
      ) : null}

      <Card className="mt-8 space-y-4 p-6">
        <h2 className="text-sm font-medium text-ink-soft">Category scores</h2>
        <ScoreMeter label="Technical" value={report.category_scores.technical} />
        <ScoreMeter label="Communication" value={report.category_scores.communication} />
        <ScoreMeter label="Problem solving" value={report.category_scores.problem_solving} />
      </Card>

      <Delivery metrics={report.delivery_metrics} />

      {report.strengths.length > 0 && (
        <Section title="What worked">
          <ul className="space-y-4">
            {report.strengths.map((s, i) => (
              <li key={i}>
                <p className="text-sm font-medium">{s.point}</p>
                <Quote>{s.example}</Quote>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.weaknesses.length > 0 && (
        <Section title="What didn't">
          <ul className="space-y-5">
            {report.weaknesses.map((w, i) => (
              <li key={i}>
                <p className="text-sm font-medium">{w.point}</p>
                <Quote>{w.example}</Quote>
                <p className="mt-2 rounded-lg bg-ember-soft px-3 py-2 text-sm text-ember-hot">
                  <span className="font-medium">Fix:</span> {w.fix}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(report.best_answer || report.worst_answer) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {report.best_answer && (
            <Highlight
              sessionId={sessionId}
              label="Strongest answer"
              tone="strong"
              h={report.best_answer}
              hasAudio={audioTurns.has(report.best_answer.turn_index)}
            />
          )}
          {report.worst_answer && (
            <Highlight
              sessionId={sessionId}
              label="Weakest answer"
              tone="weak"
              h={report.worst_answer}
              hasAudio={audioTurns.has(report.worst_answer.turn_index)}
            />
          )}
        </div>
      )}

      {report.next_steps.length > 0 && (
        <Section title="Do this next">
          <ol className="space-y-3">
            {report.next_steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="font-mono text-xs text-ember">{String(i + 1).padStart(2, "0")}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Replay
        sessionId={sessionId}
        turns={turns.map((t) => {
          const hash = repo.questionHash(t.question);
          return {
            turn_id: t.id,
            turn_index: t.turnIndex,
            question: t.question,
            question_type: t.questionType,
            transcript: t.transcript,
            has_audio: Boolean(t.audioKey),
            video_id: t.videoId && playableVideoIds.has(t.videoId) ? t.videoId : null,
            video_offset_ms: t.videoOffsetMs,
            question_hash: hash,
            starred: starredHashes.has(hash),
            feedback: feedbackByTurn.get(t.turnIndex) ?? null,
          };
        })}
      />

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-8">
        <ButtonLink href="/new">Run another</ButtonLink>
        {/* Same questions, second attempt — the only way to measure progress on
            identical material rather than on a new set. */}
        <RetryButton sessionId={sessionId} />
        <ButtonLink href="/dashboard" variant="secondary">
          Back to dashboard
        </ButtonLink>
        <DeleteInterviewButton sessionId={sessionId} />
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <Card className="p-6">
        <h2 className="mb-4 font-display text-2xl tracking-tight">{title}</h2>
        {children}
      </Card>
    </section>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="mt-1.5 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-soft italic">
      “{children}”
    </blockquote>
  );
}

function Highlight({
  sessionId,
  label,
  tone,
  h,
  hasAudio,
}: {
  sessionId: string;
  label: string;
  tone: "strong" | "weak";
  h: { turn_index: number; quote: string; why: string };
  hasAudio: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span
          className={cx("size-1.5 rounded-full", tone === "strong" ? "bg-strong" : "bg-weak")}
        />
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        <span className="ml-auto font-mono text-xs text-ink-muted">Q{h.turn_index + 1}</span>
      </div>
      <Quote>{h.quote}</Quote>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{h.why}</p>
      {hasAudio ? (
        <div className="mt-3">
          <PlayAnswer sessionId={sessionId} turnIndex={h.turn_index} />
        </div>
      ) : null}
    </Card>
  );
}
