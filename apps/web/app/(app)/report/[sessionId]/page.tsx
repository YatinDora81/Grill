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
import * as repo from "@/lib/db/repo";
import { DIFFICULTY_META } from "@/lib/interviewMeta";
import { settleUnfinishedVideos } from "@/lib/services/videoService";
import { BAND_LABEL, cx, scoreBand, scoreTone } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { Reveal } from "@/components/Reveal";
import { ScoreBand } from "@/components/ScoreBand";
import { DeleteInterviewButton } from "./DeleteInterviewButton";
import { Delivery } from "./Delivery";
import { FinishReport } from "./FinishReport";
import { PlayAnswer } from "./PlayAnswer";
import { Replay } from "./Replay";
import { ReportNav, type Section } from "./ReportNav";
import { RetryButton } from "./RetryButton";
import { ShareControl } from "./ShareControl";

export const metadata: Metadata = {
  title: "Report",
  description: "Scores, per-question feedback and delivery for this interview.",
};
export const dynamic = "force-dynamic";

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;
const tone = (v: number) => TONE_CLASS[scoreTone(v)];

const DAY_MS = 86_400_000;

/**
 * How many next steps make it onto the page. The coach is asked to rank them by
 * how much each would raise the score, biggest gain first, so this keeps the top
 * of that ranking rather than an arbitrary slice. Anything past it is not shown
 * anywhere else on the report, which is why the section says out loud how many
 * were dropped.
 */
const FIX_LIMIT = 3;

/**
 * Longest opening sentence still allowed to become a fix's mono uppercase
 * title. Past this it stays in the body: the title is set in wide-tracked caps
 * at a 280px measure, where a long sentence turns into five lines of shouting
 * and buries the fix underneath it.
 */
const FIX_TITLE_MAX = 64;

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

  const feedbackByTurn = new Map(report.question_feedback.map((f) => [f.turn_index, f] as const));

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

  const shareIsLive = await repo.hasLiveReportShare(sessionId, userId);

  const cats = report.category_scores;
  const fixes = report.next_steps.slice(0, FIX_LIMIT);
  const hasHighlights = Boolean(report.best_answer || report.worst_answer);
  const hasEvidence = hasHighlights || report.strengths.length > 0 || report.weaknesses.length > 0;

  // Nav entry and section heading are the same promise, so they flip together:
  // with no best/worst answer the section is only the strengths/weaknesses list.
  const highlights = hasHighlights
    ? { nav: "Best & worst", kicker: "Your best and worst answer" }
    : { nav: "What worked, what didn't", kicker: "What worked, what didn't" };

  /**
   * Only the sections that actually rendered. A nav entry pointing at an id that
   * never made it into the DOM is a link that silently does nothing, and the
   * observer would keep it permanently unlit.
   */
  const sections: Section[] = [
    { id: "verdict", label: "The verdict" },
    ...(fixes.length > 0 ? [{ id: "fixes", label: "Fix these" }] : []),
    { id: "sounded", label: "How you sounded" },
    ...(hasEvidence ? [{ id: "highlights", label: highlights.nav }] : []),
    ...(turns.length > 0 ? [{ id: "questions", label: "Every question" }] : []),
  ];

  const title = session.name?.trim() || session.role?.trim() || "Interview";

  /**
   * The facts about the run itself, stacked down the right of the headline.
   * Read off the session rather than the report so nothing here is a judgement
   * — the verdict owns all of those.
   *
   * `en-GB` is pinned rather than left to the runtime: this renders once on the
   * server, so the format would otherwise be whatever locale the container
   * happens to boot with, and change under the reader on a redeploy.
   *
   * Difficulty is read through the lookup rather than `difficultyLabel` because
   * sessions predating the current four levels carry a value that isn't in it,
   * and a missing line is better than a crashed report.
   */
  const config = session.config as unknown as Partial<InterviewConfig>;
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
    // The role only earns a line once the name isn't already it.
    session.name?.trim() && session.role?.trim() ? session.role.trim() : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight keylight-report" aria-hidden="true" />

      <main className="wrap report-main">
        {/* Sits above the back link because it is the page's own chrome: it has
            to be the thing pinned to the top edge once you start scrolling. */}
        <ReportNav sections={sections} />

        <Link href="/dashboard" className="back">
          ← Dashboard
        </Link>

        <ExplainBanner />

        {/* Decision first: the verdict in plain words, the number they came for,
            and the bar that number is being judged against.

            No `.rv` on this or any other section the nav can jump to — the reveal
            observer unobserves after the first intersection, so a jump into a
            section that has never been on screen would land on faded content.

            Every nav target carries `.nav-target` and an `aria-label`: the label
            names the region the jump handler focuses, and the class keeps a
            native anchor jump (cmd-click, or a reload on #verdict) from landing
            underneath the sticky chrome. It's a class rather than `scroll-mt-*`
            because the offset is two tokens deep and has to stay identical to
            `.turn`'s — see globals.css. */}
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
            </p>
          </header>

          {/* The score and the three lenses in one bordered block, split by a
              hairline. They are one judgement read two ways, and the old layout
              — a ring floated beside the headline, the lenses in a card further
              down — let a reader take the number without ever meeting the
              breakdown that explains it. */}
          <div className="mt-7 grid border border-line md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            {/* The one gradient on the page. Heat behind the number the reader
                came for, kept to a wash — a flat ember panel would read as an
                alert rather than a score.

                Its strength is a token rather than the 9% that used to be typed
                here, and it had to become one: an inline style sits at the top
                of the cascade, so no scoped rule can reach in and correct it.
                9% of a printed ember over a near-white card is precisely the
                alert panel this comment exists to avoid, which is why the light
                value is 5%. The terminator goes through `--keylight-fade` for
                the reason all six fade-outs in the product do — `transparent`
                is alpha-zero BLACK, invisible over black and a grey cast dragged
                through the middle of the same fade over cream. */}
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
              {/* A sibling of the lens rows, never inside one — and never inside
                  a `<p>`: Explain renders one, and the parser closes the outer
                  paragraph before React sees the nesting. */}
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

        {/* What to do about it, above the evidence for it: the page is read top
            to bottom exactly once, and the actions are what the reader came for. */}
        {fixes.length > 0 && (
          <section className="section nav-target" id="fixes" aria-label="Fix these">
            <SectionHead title="Fix these things" note="ranked · biggest gain first" />
            {/* One hairline lattice rather than separate cards: the container
                draws the top and left edges, each cell the right and bottom, so
                every column shares one border at every breakpoint and nothing
                needs a `:first-child` exception. */}
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
            {/* Says what was cut instead of implying these are all of them. */}
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

        {/* The section wrapper lives here rather than in `Delivery` so all four
            of the report's section heads are set in one place, and so this one
            carries `.nav-target` like every other jump target. */}
        <section className="section nav-target" id="sounded" aria-label="How you sounded">
          <SectionHead title="How you sounded" note="measured from the recording · never guessed" />
          <Delivery metrics={report.delivery_metrics} />
        </section>

        {hasEvidence && (
          <section className="section nav-target" id="highlights" aria-label={highlights.nav}>
            <SectionHead title={highlights.kicker} note="straight from your own recording" />

            {/* Two columns only when there are two answers to show: a single
                cell in a two-column lattice would leave the block's right edge
                undrawn. */}
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

        {/* The id lives on a wrapper: `Replay` owns the accordion, not the
            section head. The role is what makes the label reach a screen reader
            — a bare div is not exposed, so the focus the nav moves here would
            land somewhere unnamed. */}
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
              return {
                turn_id: t.id,
                turn_index: t.turnIndex,
                question: t.question,
                question_type: t.questionType,
                transcript: t.transcript,
                transcript_words: parseTranscriptWords(t.transcriptWords),
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
          <Explain>
            Where an answer kept its <b>word timings</b>, the words light up in time with the
            recording as it plays — and <b>clicking any word seeks the player to it</b>, so you can
            hear one phrase back without hunting for it. Fillers stay tinted even when the audio has
            been purged and there is nothing left to play.
          </Explain>
        </div>

        <ShareControl sessionId={sessionId} sessionName={title} initiallyShared={shareIsLive} />

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

/**
 * The heading over a report section: what it is, and in mono beside it, what it
 * is measured from. The right-hand line is where a section says its own
 * provenance — "measured from the recording", "straight from your own
 * recording" — which is the claim this product lives or dies on.
 */
const VERDICT_MID_FROM = 56;
const VERDICT_LONG_FROM = 112;

function verdictTier(verdict: string): string {
  if (verdict.length >= VERDICT_LONG_FROM) return "verdict-long";
  if (verdict.length >= VERDICT_MID_FROM) return "verdict-mid";
  return "";
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

/**
 * Splits a next step into a headline and the rest of itself.
 *
 * The coach writes each step as prose, and the design wants a mono uppercase
 * title over a plain-English body. Rather than ask the model for a shape it
 * doesn't return — or invent one — the opening sentence becomes the title when
 * it is short enough to survive being set in caps and something follows it.
 * Everything else falls through as body text under the numeral, which is a
 * complete card in its own right.
 */
function splitFix(step: string): { title: string; body: string } {
  const text = step.trim();
  const m = new RegExp(`^(.{1,${FIX_TITLE_MAX}}?)[.!?]\\s+(\\S[\\s\\S]*)$`).exec(text);
  // Both groups are checked rather than asserted: `noUncheckedIndexedAccess`
  // types them as possibly-undefined, and a fix card with an empty title reads
  // as a rendering bug, so falling through to plain body text is the safer miss.
  const [, title, body] = m ?? [];
  if (!title || !body) return { title: "", body: text };
  const lastWord = title.split(/\s+/).pop() ?? "";
  if (lastWord.includes(".") || (lastWord.length <= 2 && !/^[A-Z]/.test(body))) {
    return { title: "", body: text };
  }
  return { title, body };
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
    <div className="border-r border-b border-line p-6">
      <div className="hl-head">
        <span className={cx("hl-label", `tone-${variant}`)}>
          <span aria-hidden="true">{variant === "strong" ? "▲" : "▼"}</span> {label}
        </span>
        <span className="hl-q">Q{h.turn_index + 1}</span>
      </div>
      {/* The rule down the left is the tone: it carries the strong/weak read
          that the card's own top border used to, now that the two cards share
          one box instead of being separate panels.

          A token rather than a `/50` alpha modifier because the strength is not
          the same in both modes: a translucent rule on a bright ground reads
          weaker than the same rule on a dark one, so on paper it is laid down
          at 70%. Same pair as `.quote-strong` / `.quote-weak`, which is the
          point of routing all four through one token each. */}
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
