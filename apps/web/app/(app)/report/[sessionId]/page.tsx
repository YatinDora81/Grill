import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type {
  AnswerHighlight,
  AnswerScores,
  CategoryScores,
  Difficulty,
  InterviewConfig,
  Report as ReportDTO,
  TranscriptWord,
} from "@repo/types";
import { getUserId } from "@/lib/auth";
import {
  cameraMetricsSchema,
  deliveryMetricsSchema,
  starBreakdownsSchema,
  storedCodeSubmissionSchema,
  storedDesignReviewSchema,
} from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { presignGet } from "@/lib/storage/objectStore";
import { takeMs } from "@/lib/camera/summarize";
import { DIFFICULTY_META } from "@/lib/interviewMeta";
import { compareSessions } from "@/lib/services/compareService";
import { settleUnfinishedVideos } from "@/lib/services/videoService";
import { BAND_LABEL, cx, scoreBand, scoreTone } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { Reveal } from "@/components/Reveal";
import { ScoreBand } from "@/components/ScoreBand";
import { PrepBrief } from "../../new/PrepBrief";
import { CodeReplay, type CodeReplayTurn } from "./CodeReplay";
import { DeleteInterviewButton } from "./DeleteInterviewButton";
import { DesignReplay, type DesignReplayTurn } from "./DesignReplay";
import { Delivery } from "./Delivery";
import { FinishReport } from "./FinishReport";
import { PlayAnswer } from "./PlayAnswer";
import { Replay } from "./Replay";
import { ReportNav, type Section } from "./ReportNav";
import { RetryButton } from "./RetryButton";
import { ShareControl } from "./ShareControl";
import { RetryForward, ThenVsNow } from "./ThenVsNow";

export const metadata: Metadata = {
  title: "Report",
  description: "Scores, per-question feedback and delivery for this interview.",
};
export const dynamic = "force-dynamic";

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;
const tone = (v: number) => TONE_CLASS[scoreTone(v)];

const DAY_MS = 86_400_000;

const FIX_LIMIT = 3;

const FIX_TITLE_MAX = 64;

const DESIGN_IMAGE_TTL_S = 3_600;

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
    delivery_metrics: readDeliveryMetrics(row.deliveryMetrics),
    strengths: row.strengths as unknown as ReportDTO["strengths"],
    weaknesses: row.weaknesses as unknown as ReportDTO["weaknesses"],
    best_answer: row.bestAnswer as unknown as ReportDTO["best_answer"],
    worst_answer: row.worstAnswer as unknown as ReportDTO["worst_answer"],
    next_steps: row.nextSteps as unknown as ReportDTO["next_steps"],
    question_feedback: (row.questionFeedback as unknown as ReportDTO["question_feedback"]) ?? [],
    star_breakdown: starBreakdownsSchema.parse(row.starBreakdown),
    created_at: row.createdAt.toISOString(),
  };

  const feedbackByTurn = new Map(report.question_feedback.map((f) => [f.turn_index, f] as const));
  const starByTurn = new Map(report.star_breakdown.map((b) => [b.turn_index, b] as const));

  const turns = await repo.getTurns(sessionId);

  await settleUnfinishedVideos(sessionId).catch(() => {});

  const videos = await repo.listSessionVideos(sessionId);
  const playableVideoIds = new Set(videos.map((v) => v.id));
  const expiryById = new Map(videos.map((v) => [v.id, v.expiresAt] as const));
  const now = Date.now();

  const starredHashes = await repo.starredHashesFor(
    userId,
    turns.map((t) => t.question),
  );
  const audioTurns = new Set(turns.filter((t) => t.audioKey).map((t) => t.turnIndex));
  const videoTurns = new Set(
    turns
      .filter((t) => t.videoId && playableVideoIds.has(t.videoId) && t.videoOffsetMs !== null)
      .map((t) => t.turnIndex),
  );

  const parent = await repo.getRetryParent(session, userId);
  const before = parent?.report;

  const comparison = session.retryOfId ? await compareSessions(userId, sessionId) : null;

  const retries = await repo.getRetriesOf(sessionId, userId);

  const shareIsLive = await repo.hasLiveReportShare(sessionId, userId);

  const codeTurns: CodeReplayTurn[] = turns.flatMap((t) => {
    const parsed = storedCodeSubmissionSchema.safeParse(t.codeSubmission);
    if (!parsed.success) return [];
    return [
      {
        turn_index: t.turnIndex,
        title: t.question.split("\n")[0]?.trim() || `Problem ${t.turnIndex + 1}`,
        submission: parsed.data,
      },
    ];
  });

  const designTurns: DesignReplayTurn[] = [];
  for (const t of turns) {
    const parsed = storedDesignReviewSchema.safeParse(t.designReview);
    if (!parsed.success) continue;
    designTurns.push({
      turn_index: t.turnIndex,
      title: t.question.split("\n")[0]?.trim() || `Design ${t.turnIndex + 1}`,
      review: parsed.data,
      image_url: t.designImageKey
        ? await presignGet(t.designImageKey, DESIGN_IMAGE_TTL_S).catch(() => null)
        : null,
    });
  }

  const cats = report.category_scores;
  const fixes = report.next_steps.slice(0, FIX_LIMIT);
  const hasHighlights = Boolean(report.best_answer || report.worst_answer);
  const hasEvidence = hasHighlights || report.strengths.length > 0 || report.weaknesses.length > 0;

  const highlights = hasHighlights
    ? { nav: "Best & worst", kicker: "Your best and worst answer" }
    : { nav: "What worked, what didn't", kicker: "What worked, what didn't" };

  const config = session.config as unknown as Partial<InterviewConfig>;
  const company = typeof config.company === "string" ? config.company.trim() : "";
  const wasLive = config.live === true;

  const sections: Section[] = [
    { id: "verdict", label: "The verdict" },
    ...(comparison ? [{ id: "compare", label: "Then vs now" }] : []),
    ...(fixes.length > 0 ? [{ id: "fixes", label: "Fix these" }] : []),
    { id: "sounded", label: "How you sounded" },
    ...(hasEvidence ? [{ id: "highlights", label: highlights.nav }] : []),
    ...(turns.length > 0 ? [{ id: "questions", label: "Every question" }] : []),
    ...(company ? [{ id: "brief", label: "Prep brief" }] : []),
  ];

  const title = session.name?.trim() || session.role?.trim() || "Interview";

  const meta = [
    new Date(report.created_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    [
      `${turns.length} question${turns.length === 1 ? "" : "s"}`,
      DIFFICULTY_META[config.difficulty as Difficulty]?.label,
    ]
      .filter(Boolean)
      .join(" · "),
    session.name?.trim() && session.role?.trim() ? session.role.trim() : null,
    company && !title.toLowerCase().includes(company.toLowerCase()) ? `for ${company}` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight keylight-report" aria-hidden="true" />

      <main className="wrap report-main">
        <ReportNav sections={sections} />

        <Link href="/dashboard" className="back">
          ← Dashboard
        </Link>

        <ExplainBanner />

        <section id="verdict" aria-label="The verdict" className="nav-target">
          <header className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div style={{ minWidth: 0, flex: "1 1 340px" }}>
              <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
                Report — {title}
              </p>
              <h1 className={cx("verdict", verdictTier(report.verdict))}>{report.verdict}</h1>
            </div>
            <p className="font-mono text-[0.64rem] leading-[2] tracking-[0.12em] uppercase text-ink-muted sm:text-right">
              {meta.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {company ? (
                <a href="#brief" className="vs-label block">
                  Prep brief <span aria-hidden="true">↓</span>
                </a>
              ) : null}
            </p>
          </header>

          <div className="mt-7 grid border border-line md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div
              className="border-b border-line p-6 sm:p-8 md:border-r md:border-b-0"
              style={{
                background: `radial-gradient(90% 90% at 30% 20%, var(--verdict-wash), var(--keylight-fade) 60%), var(--color-paper-raised)`,
              }}
            >
              <p className="font-mono text-[0.58rem] tracking-[0.22em] uppercase text-ink-muted">
                Overall verdict
              </p>
              <p
                className={cx(
                  "mt-3 font-display text-[3.4rem] leading-none font-extrabold tracking-[-0.02em] tabular",
                  tone(report.overall_score),
                )}
              >
                {report.overall_score}
                <span className="ml-1 font-mono text-[0.2em] font-medium text-ink-muted">/100</span>
              </p>
              <ScoreBand score={report.overall_score} />
              <Explain>
                {report.overall_score} out of 100 puts this run in{" "}
                <b>{BAND_LABEL[scoreBand(report.overall_score)].toLowerCase()}</b>. The four bands
                are the same on every report, so the rung you are on is comparable across runs even
                when the questions were not.
              </Explain>

              {before ? (
                <>
                  <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-dashed border-line-strong pt-4">
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
                  <Explain>
                    Each arrow is this run&rsquo;s mark minus the same mark on that earlier run — a
                    gap in points, not a percentage. It only compares those two runs, and the
                    questions were almost certainly different, which is why the <b>band</b> above is
                    the steadier read.
                  </Explain>
                </>
              ) : null}

              {retries ? (
                <div className="mt-6 border-t border-dashed border-line-strong pt-4">
                  <RetryForward
                    count={retries.count}
                    latestId={retries.latest.id}
                    latestScored={retries.latest.overallScore !== null}
                  />
                </div>
              ) : null}
            </div>

            <div className="grid content-start gap-6 p-6 sm:p-7">
              {(
                [
                  ["Technical", cats.technical, 0],
                  ["Communication", cats.communication, 0.12],
                  ["Problem solving", cats.problem_solving, 0.24],
                ] as const
              ).map(([label, value, delay]) => (
                <div
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-2"
                  key={label}
                >
                  <span className="font-mono text-[0.66rem] tracking-[0.14em] uppercase text-ink-soft">
                    {label}
                  </span>
                  <span
                    className={cx("font-mono text-[1.02rem] font-semibold tabular", tone(value))}
                  >
                    {value}
                    <span className="ml-0.5 text-[0.6rem] font-normal text-ink-muted">/100</span>
                  </span>
                  <div className="meter col-span-2">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, value))}%`,
                        animationDelay: `${delay}s`,
                      }}
                    />
                  </div>
                </div>
              ))}
              <Explain>
                Three separate marks out of 100 from the same coach that wrote the verdict, and each
                bar is just that number as a share of 100. <b>Technical</b> is whether the content
                was right, <b>communication</b> is whether it landed, <b>problem solving</b> is how
                you got there. The score above is not their average — it&rsquo;s its own judgement,
                so one weak dimension doesn&rsquo;t mechanically drag it down.
              </Explain>
            </div>
          </div>
        </section>

        {comparison ? (
          <section className="section nav-target" id="compare" aria-label="Then vs now">
            <SectionHead title="Then vs now" note="same questions · both runs" />
            <ThenVsNow comparison={comparison} />
          </section>
        ) : null}

        {fixes.length > 0 && (
          <section className="section nav-target" id="fixes" aria-label="Fix these">
            <SectionHead title="Fix these things" note="ranked · biggest gain first" />
            <div
              className={cx(
                "mt-4 grid border-t border-l border-line",
                fixes.length === 2 && "md:grid-cols-2",
                fixes.length > 2 && "md:grid-cols-3",
              )}
            >
              {fixes.map((s, i) => {
                const { title: fixTitle, body } = splitFix(s);
                return (
                  <div className="border-r border-b border-line p-6" key={i}>
                    <p className="font-display text-[1.6rem] leading-none font-bold text-ember">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    {fixTitle ? (
                      <p className="mt-3.5 font-mono text-[0.72rem] leading-normal tracking-[0.1em] uppercase text-ink">
                        {fixTitle}
                      </p>
                    ) : null}
                    {body ? (
                      <p className="mt-2.5 text-[0.89rem] leading-relaxed text-ink-soft">{body}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {report.next_steps.length > fixes.length ? (
              <p className="mono-note" style={{ marginTop: 14 }}>
                top {fixes.length} of {report.next_steps.length} · the rest ranked lower
              </p>
            ) : null}
            <Explain>
              Written for this run by the same coach that scored it, and ranked by how much it
              thinks each one would raise your score — so <b>01</b> is the biggest win, not just the
              first thing it typed. The ranking is its judgement, not a measurement: there is no
              points figure behind it.
            </Explain>
          </section>
        )}

        <section className="section nav-target" id="sounded" aria-label="How you sounded">
          <SectionHead
            title="How you sounded"
            note={wasLive ? "live conversation · nothing measured" : "measured from the recording · never guessed"}
          />
          {wasLive ? (
            <p className="mono-note" style={{ marginTop: 16 }}>
              This was a live conversation &mdash; pace, tone and camera were not measured.
            </p>
          ) : (
            <Delivery metrics={report.delivery_metrics} />
          )}
        </section>

        {hasEvidence && (
          <section className="section nav-target" id="highlights" aria-label={highlights.nav}>
            <SectionHead title={highlights.kicker} note="straight from your own recording" />

            {hasHighlights && (
              <div
                className={cx(
                  "mt-4 grid border-t border-l border-line",
                  report.best_answer && report.worst_answer && "md:grid-cols-2",
                )}
              >
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
            )}

            {report.strengths.length > 0 && (
              <div className="mt-12">
                <p className="kicker">What worked</p>
                {report.strengths.map((s, i) => (
                  <div className="point" key={i}>
                    <p className="point-t">{s.point}</p>
                    <p className="quote quote-strong">“{s.example}”</p>
                  </div>
                ))}
              </div>
            )}

            {report.weaknesses.length > 0 && (
              <div className="mt-12">
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
              </div>
            )}
          </section>
        )}

        <div
          id="questions"
          role="region"
          aria-label="Every question"
          className="section nav-target"
        >
          <SectionHead
            title="Every question, one by one"
            note="what you said · why it scored · what to say instead"
          />
          <Replay
            sessionId={sessionId}
            defaultOpenIndex={report.best_answer?.turn_index ?? null}
            turns={turns.map((t) => {
              const hash = repo.questionHash(t.question);
              const videoId = t.videoId && playableVideoIds.has(t.videoId) ? t.videoId : null;
              const expiresAt = videoId ? expiryById.get(videoId) : undefined;
              const words = parseTranscriptWords(t.transcriptWords);
              const camera = cameraMetricsSchema.safeParse(t.cameraMetrics);
              const away =
                camera.success && camera.data.away_segments.length > 0
                  ? camera.data.away_segments
                  : null;
              const lastWordEnd = words?.length ? (words[words.length - 1]?.end ?? null) : null;
              return {
                turn_id: t.id,
                turn_index: t.turnIndex,
                question: t.question,
                question_type: t.questionType,
                transcript: t.transcript,
                transcript_words: words,
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
                star: starByTurn.get(t.turnIndex) ?? null,
                away_segments: away,
                take_ms: away ? takeMs(lastWordEnd, away) : null,
              };
            })}
          />
          <Explain>
            Where an answer kept its <b>word timings</b>, the words light up in time with the
            recording as it plays — and <b>clicking any word seeks the player to it</b>, so you can
            hear one phrase back without hunting for it. Fillers stay tinted even when the audio has
            been purged and there is nothing left to play. The red marks under a transcript are the
            moments you were looking away from the camera, on the same clock — <b>click one</b> to
            hear what you were saying then.
          </Explain>
          <CodeReplay turns={codeTurns} />
          <DesignReplay turns={designTurns} />
        </div>

        {company ? (
          <div id="brief" role="region" aria-label="Prep brief" className="section nav-target">
            <SectionHead title="Before the real thing" note="about them · not about your run" />
            <PrepBrief company={company} role={session.role} />
          </div>
        ) : null}

        <ShareControl sessionId={sessionId} sessionName={title} initiallyShared={shareIsLive} />

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

const VERDICT_MID_FROM = 56;
const VERDICT_LONG_FROM = 112;

function verdictTier(verdict: string): string {
  if (verdict.length >= VERDICT_LONG_FROM) return "verdict-long";
  if (verdict.length >= VERDICT_MID_FROM) return "verdict-mid";
  return "";
}

function readDeliveryMetrics(value: unknown): ReportDTO["delivery_metrics"] {
  const parsed = deliveryMetricsSchema.safeParse(value);
  const m = parsed.success ? parsed.data : deliveryMetricsSchema.parse({});
  return {
    ...m,
    wpm: m.wpm ?? 0,
    avg_pause_ms: m.avg_pause_ms ?? 0,
    filler_count: m.filler_count ?? 0,
  };
}

function parseTranscriptWords(value: unknown): TranscriptWord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const words: TranscriptWord[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { word, start, end } = item as Record<string, unknown>;
    if (typeof word !== "string") return null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    words.push({ word, start: start as number, end: end as number });
  }
  return words;
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-line pb-2.5">
      <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
        {title}
      </h2>
      <p className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-ink-muted">{note}</p>
    </div>
  );
}

function splitFix(step: string): { title: string; body: string } {
  const text = step.trim();
  const m = new RegExp(`^(.{1,${FIX_TITLE_MAX}}?)[.!?]\\s+(\\S[\\s\\S]*)$`).exec(text);
  const [, title, body] = m ?? [];
  if (!title || !body) return { title: "", body: text };
  const lastWord = title.split(/\s+/).pop() ?? "";
  if (lastWord.includes(".") || (lastWord.length <= 2 && !/^[A-Z]/.test(body))) {
    return { title: "", body: text };
  }
  return { title, body };
}

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
    <div className="border-r border-b border-line p-6">
      <div className="hl-head">
        <span className={cx("hl-label", `tone-${variant}`)}>
          <span aria-hidden="true">{variant === "strong" ? "▲" : "▼"}</span> {label}
        </span>
        <span className="hl-q">Q{h.turn_index + 1}</span>
      </div>
      <p
        className={cx(
          "hl-quote border-l-2 pl-4",
          variant === "strong" ? "border-(--edge-verdict-strong)" : "border-(--edge-verdict-weak)",
        )}
      >
        “{h.quote}”
      </p>
      <p className="hl-why">{h.why}</p>
      {hasAudio || hasVideo ? (
        <div className="hl-actions">
          {hasAudio ? (
            <PlayAnswer sessionId={sessionId} turnIndex={h.turn_index} label="play answer" />
          ) : null}
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
