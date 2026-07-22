import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type {
  AnswerHighlight,
  AnswerScores,
  CategoryScores,
  Report as ReportDTO,
} from "@repo/types";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos } from "@/lib/services/videoService";
import { cx, scoreTone } from "@/components/ui";
import { Reveal } from "@/components/Reveal";
import { DeleteInterviewButton } from "./DeleteInterviewButton";
import { Delivery } from "./Delivery";
import { FinishReport } from "./FinishReport";
import { PlayAnswer } from "./PlayAnswer";
import { Replay } from "./Replay";
import { RetryButton } from "./RetryButton";

export const metadata: Metadata = {
  title: "Report",
  description: "Scores, per-question feedback and delivery for this interview.",
};
export const dynamic = "force-dynamic";

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;
const tone = (v: number) => TONE_CLASS[scoreTone(v)];

const DAY_MS = 86_400_000;

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
  if (!userId) redirect(`/?auth=login&next=/report/${sessionId}`);

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
  const videos = await repo.listSessionVideos(sessionId);
  const playableVideoIds = new Set(videos.map((v) => v.id));
  // Retention is real and worth saying out loud — the tape does not keep.
  const expiryById = new Map(videos.map((v) => [v.id, v.expiresAt] as const));
  const now = Date.now();

  // One query for the whole replay rather than one per turn: a 100-question
  // report would otherwise open 100 connections to paint 100 star icons.
  const starredHashes = await repo.starredHashesFor(
    userId,
    turns.map((t) => t.question),
  );
  const audioTurns = new Set(turns.filter((t) => t.audioKey).map((t) => t.turnIndex));
  // Turn indices whose recording is actually playable — what gates "watch".
  const videoTurns = new Set(
    turns
      .filter((t) => t.videoId && playableVideoIds.has(t.videoId) && t.videoOffsetMs !== null)
      .map((t) => t.turnIndex),
  );

  // If this run retried an earlier one, the questions were identical — so the
  // two scores are directly comparable. Only worth showing once the parent has
  // a report of its own to compare against.
  const parent = await repo.getRetryParent(session, userId);
  const before = parent?.report;

  const cats = report.category_scores;
  const crumb = [session.name?.trim() || session.role?.trim() || "Interview"]
    // The role only earns a slot once the name isn't already it.
    .concat(session.name?.trim() && session.role?.trim() ? [session.role.trim()] : [])
    .concat(report.created_at.slice(0, 10))
    .join(" · ");

  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight keylight-report" aria-hidden="true" />

      <main className="wrap report-main">
        <Link href="/dashboard" className="back">
          ← Dashboard
        </Link>

        {/* The verdict in plain words, and the number they came for. */}
        <header className="report-hero">
          <div style={{ minWidth: 0, flex: "1 1 340px" }}>
            <p className="crumb">{crumb}</p>
            <h1 className="verdict">{report.verdict}</h1>
          </div>
          <Ring score={report.overall_score} />
        </header>

        {before ? (
          <div className="vs rv" data-io>
            <Link href={`/report/${before.sessionId}`} className="vs-label">
              vs your run on {before.createdAt.toISOString().slice(0, 10)}
            </Link>
            <Delta
              label="overall"
              now={report.overall_score}
              before={before.overallScore}
            />
            {(
              [
                ["tech", "technical"],
                ["comm", "communication"],
                ["probl.", "problem_solving"],
              ] as const
            ).map(([label, key]) => (
              <Delta
                key={key}
                label={label}
                now={cats[key]}
                before={(before.categoryScores as unknown as CategoryScores)[key]}
              />
            ))}
          </div>
        ) : null}

        <section className="section rv" data-io>
          <p className="kicker">The scores</p>
          <div className="card card-hairline" style={{ marginTop: 16 }}>
            <div className="meters">
              {(
                [
                  ["Technical", cats.technical, 0],
                  ["Communication", cats.communication, 0.12],
                  ["Problem solving", cats.problem_solving, 0.24],
                ] as const
              ).map(([label, value, delay]) => (
                <div className="meter-row" key={label}>
                  <span className="meter-k">{label}</span>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, value))}%`,
                        animationDelay: `${delay}s`,
                      }}
                    />
                  </div>
                  <span className={cx("meter-v", tone(value))}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Delivery metrics={report.delivery_metrics} />

        {report.strengths.length > 0 && (
          <section className="section rv" data-io>
            <p className="kicker">What worked</p>
            {report.strengths.map((s, i) => (
              <div className="point" key={i}>
                <p className="point-t">{s.point}</p>
                <p className="quote quote-strong">“{s.example}”</p>
              </div>
            ))}
          </section>
        )}

        {report.weaknesses.length > 0 && (
          <section className="section rv" data-io>
            <p className="kicker">What didn&apos;t</p>
            {report.weaknesses.map((w, i) => (
              <div className="point" key={i}>
                <p className="point-t">{w.point}</p>
                <p className="quote quote-weak">“{w.example}”</p>
                <p className="fix">
                  <b>fix</b>
                  <span>{w.fix}</span>
                </p>
              </div>
            ))}
          </section>
        )}

        {(report.best_answer || report.worst_answer) && (
          <section className="section rv" data-io>
            <p className="kicker">On the record</p>
            <div className="hl-grid">
              {report.best_answer && (
                <Highlight
                  sessionId={sessionId}
                  label="Strongest answer"
                  variant="strong"
                  h={report.best_answer}
                  hasAudio={audioTurns.has(report.best_answer.turn_index)}
                  hasVideo={videoTurns.has(report.best_answer.turn_index)}
                />
              )}
              {report.worst_answer && (
                <Highlight
                  sessionId={sessionId}
                  label="Weakest answer"
                  variant="weak"
                  h={report.worst_answer}
                  hasAudio={audioTurns.has(report.worst_answer.turn_index)}
                  hasVideo={videoTurns.has(report.worst_answer.turn_index)}
                />
              )}
            </div>
          </section>
        )}

        {report.next_steps.length > 0 && (
          <section className="section rv" data-io>
            <p className="kicker">Do this next</p>
            <div className="steps">
              {report.next_steps.map((s, i) => (
                <p className="stepline" key={i}>
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  <span>{s}</span>
                </p>
              ))}
            </div>
          </section>
        )}

        <Replay
          sessionId={sessionId}
          defaultOpenIndex={report.best_answer?.turn_index ?? null}
          turns={turns.map((t) => {
            const hash = repo.questionHash(t.question);
            const videoId = t.videoId && playableVideoIds.has(t.videoId) ? t.videoId : null;
            const expiresAt = videoId ? expiryById.get(videoId) : undefined;
            return {
              turn_id: t.id,
              turn_index: t.turnIndex,
              question: t.question,
              question_type: t.questionType,
              transcript: t.transcript,
              has_audio: Boolean(t.audioKey),
              video_id: videoId,
              video_offset_ms: t.videoOffsetMs,
              video_expires_in_days: expiresAt
                ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / DAY_MS))
                : null,
              question_hash: hash,
              starred: starredHashes.has(hash),
              feedback: feedbackByTurn.get(t.turnIndex) ?? null,
              scores: (t.answerScores as unknown as AnswerScores | null) ?? null,
            };
          })}
        />

        {/* Retry is the hot action, and the only ember button on the page. */}
        <div className="endrow rv" data-io>
          <div>
            <RetryButton sessionId={sessionId} />
            <p className="mono-note" style={{ marginTop: 8 }}>
              same questions · comparable scores
            </p>
          </div>
          <DeleteInterviewButton sessionId={sessionId} />
        </div>
      </main>
    </>
  );
}

/** The score, seared into a ring. Arc length is the score; colour is the verdict. */
function Ring({ score }: { score: number }) {
  const R = 66;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score));

  return (
    <div className="ring-wrap" role="img" aria-label={`Overall score ${score} out of 100`}>
      <svg className="ring-svg" viewBox="0 0 148 148">
        <circle className="ring-track" cx="74" cy="74" r={R} />
        <circle
          className={cx("ring-fill", tone(score))}
          cx="74"
          cy="74"
          r={R}
          style={
            {
              "--circ": C,
              strokeDasharray: `${(C * pct) / 100} ${C}`,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="ring-num">
        <span className={cx("ring-v", tone(score))}>{score}</span>
        <span className="ring-k">out of 100</span>
      </div>
    </div>
  );
}

/**
 * One category, this run against the one it retried. A zero is drawn flat, not
 * green: the scores are rounded, so "no change" is a real answer rather than a
 * near miss rounding up.
 */
function Delta({ label, now, before }: { label: string; now: number; before: number }) {
  const d = now - before;
  return (
    <span className="delta">
      {label}{" "}
      <b className={d > 0 ? "up" : d < 0 ? "down" : "flat"}>
        {d > 0 ? "▲" : d < 0 ? "▼" : "±"}
        {Math.abs(d)}
      </b>
    </span>
  );
}

function Highlight({
  sessionId,
  label,
  variant,
  h,
  hasAudio,
  hasVideo,
}: {
  sessionId: string;
  label: string;
  variant: "strong" | "weak";
  h: AnswerHighlight;
  hasAudio: boolean;
  hasVideo: boolean;
}) {
  return (
    <div className={cx("hl", variant === "strong" ? "hl-strong" : "hl-weak")}>
      <div className="hl-head">
        <span className={cx("hl-label", `tone-${variant}`)}>{label}</span>
        <span className="hl-q">Q{h.turn_index + 1}</span>
      </div>
      <p className="hl-quote">“{h.quote}”</p>
      <p className="hl-why">{h.why}</p>
      {hasAudio || hasVideo ? (
        <div className="hl-actions">
          {hasAudio ? (
            <PlayAnswer sessionId={sessionId} turnIndex={h.turn_index} label="play answer" />
          ) : null}
          {/* Jumps to this turn in the replay and unfolds it — the tape lives
              there, next to the transcript it belongs to. */}
          {hasVideo ? (
            <a className="btn btn-ghost btn-xs" href={`#turn-${h.turn_index}`}>
              <span aria-hidden="true">▣</span> watch
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
