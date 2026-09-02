import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { CategoryScores, DeliveryMetrics, StarBreakdown } from "@repo/types";
import * as repo from "@/lib/db/repo";
import { shareTokenSchema, starBreakdownsSchema } from "@/lib/schemas";
import { BAND_LABEL, ButtonLink, cx, scoreBand, scoreTone } from "@/components/ui";
import { ScoreBand } from "@/components/ScoreBand";
import { Delivery } from "@/app/(app)/report/[sessionId]/Delivery";
import { StarBar } from "@/app/(app)/report/[sessionId]/StarBar";

export const dynamic = "force-dynamic";

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;
const tone = (v: number) => TONE_CLASS[scoreTone(v)];

const VERDICT_MID_FROM = 56;
const VERDICT_LONG_FROM = 112;

const POINT_LIMIT = 4;

const load = cache(async (token: string) => {
  const parsed = shareTokenSchema.safeParse(token);
  if (!parsed.success) return null;
  return repo.getSharedReport(createHash("sha256").update(parsed.data).digest("hex"));
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const shared = await load(token);
  if (!shared) {
    return { title: "Link not found", robots: { index: false, follow: false, nocache: true } };
  }

  const band = BAND_LABEL[scoreBand(shared.overallScore)];
  const headline = `${shared.overallScore}/100 — ${band}`;
  const description = shared.role
    ? `A Grill mock interview for ${shared.role.trim()}, scored ${shared.overallScore} out of 100. Scores and delivery only — no transcripts, no recordings.`
    : `A Grill mock interview scored ${shared.overallScore} out of 100. Scores and delivery only — no transcripts, no recordings.`;

  return {
    title: headline,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      type: "website",
      url: `/r/${token}`,
      title: `${headline} · Grill`,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${headline} · Grill`,
      description,
    },
  };
}

export default async function SharedVerdictPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await load(token);
  if (!shared) notFound();

  const cats = readCategoryScores(shared.categoryScores);
  const delivery = readDeliveryMetrics(shared.deliveryMetrics);
  const strengths = readPoints(shared.strengths);
  const weaknesses = readPoints(shared.weaknesses);
  const stars: StarBreakdown[] = starBreakdownsSchema.parse(shared.starBreakdown);

  const title = shared.name?.trim() || shared.role?.trim() || "Interview";
  const meta = [
    shared.createdAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    `${shared.questionCount} question${shared.questionCount === 1 ? "" : "s"}`,
    shared.name?.trim() && shared.role?.trim() ? shared.role.trim() : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="app-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight keylight-report" aria-hidden="true" />

      <main className="wrap report-main">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-4 sm:mt-8">
          <Link
            href="/"
            className="font-display text-[1.05rem] font-extrabold tracking-tight lowercase"
          >
            grill<span className="text-ember">.</span>
          </Link>
          <p className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-muted">
            Shared verdict · scores only
          </p>
        </div>

        <section aria-label="The verdict">
          <header className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div style={{ minWidth: 0, flex: "1 1 340px" }}>
              <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
                Verdict — {title}
              </p>
              <h1 className={cx("verdict", verdictTier(shared.verdict))}>{shared.verdict}</h1>
            </div>
            <p className="font-mono text-[0.64rem] leading-[2] tracking-[0.12em] uppercase text-ink-muted sm:text-right">
              {meta.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </header>

          <div
            className={cx(
              "mt-7 grid border border-line",
              cats && "md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]",
            )}
          >
            <div
              className={cx("border-b border-line p-6 sm:p-8", cats && "md:border-r md:border-b-0")}
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
                  tone(shared.overallScore),
                )}
              >
                {shared.overallScore}
                <span className="ml-1 font-mono text-[0.2em] font-medium text-ink-muted">/100</span>
              </p>
              <ScoreBand score={shared.overallScore} />
              <p className="mt-5 text-[0.86rem] leading-relaxed text-ink-soft">
                {shared.overallScore} out of 100 puts this run in{" "}
                <b className="text-ink">
                  {BAND_LABEL[scoreBand(shared.overallScore)].toLowerCase()}
                </b>
                . The four bands are the same on every Grill report.
              </p>
            </div>

            {cats ? (
              <div className="grid content-start gap-6 p-6 sm:p-7">
                {(
                  [
                    ["Technical", cats.technical],
                    ["Communication", cats.communication],
                    ["Problem solving", cats.problem_solving],
                  ] as const
                ).map(([label, value]) => (
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
                        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {delivery ? (
          <section className="section" aria-label="How they sounded">
            <SectionHead
              title="How they sounded"
              note="measured from the recording · never guessed"
            />
            <Delivery metrics={delivery} subject="them" />
          </section>
        ) : null}

        {stars.length > 0 ? (
          <section className="section" aria-label="How the story answers were built">
            <SectionHead
              title="How the stories were built"
              note="story answers only · shape, not words"
            />

            <div className="mt-8 grid gap-9">
              {stars.map((bar) => (
                <div key={bar.turn_index}>
                  <p className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-ink-muted">
                    Question {String(bar.turn_index + 1).padStart(2, "0")}
                  </p>
                  <div className="mt-3">
                    <StarBar breakdown={bar} showQuotes={false} />
                  </div>
                </div>
              ))}
            </div>

            <p className="mono-note" style={{ marginTop: 20 }}>
              Situation, Task, Action, Result — the four parts an interviewer listens for. The
              sentences behind each block stay private; only how long each part ran is shared.
            </p>
          </section>
        ) : null}

        {strengths.length > 0 || weaknesses.length > 0 ? (
          <section className="section" aria-label="What worked, what didn't">
            <SectionHead title="What worked, what didn't" note="the coach's read · no quotes" />

            {strengths.length > 0 ? (
              <div className="mt-8">
                <p className="kicker">What worked</p>
                {strengths.map((point) => (
                  <div className="point" key={point}>
                    <p className="point-t">{point}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {weaknesses.length > 0 ? (
              <div className="mt-10">
                <p className="kicker">What didn&apos;t</p>
                {weaknesses.map((point) => (
                  <div className="point" key={point}>
                    <p className="point-t">{point}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <p className="mono-note" style={{ marginTop: 20 }}>
              The examples behind each line stay private — they are quotes from the answers, and a
              shared verdict never carries them.
            </p>
          </section>
        ) : null}

        <div className="endrow">
          <div>
            <ButtonLink href="/signup">Get grilled yourself</ButtonLink>
            <p className="mono-note" style={{ marginTop: 8 }}>
              free · 8 questions
            </p>
          </div>
          <Link href="/sample" className="underlink">
            see a full sample report
          </Link>
        </div>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <span className="font-mono text-[0.6rem] tracking-[0.16em] uppercase text-ink-muted">
            Shared by the candidate · revocable at any time
          </span>
          <span className="foot-note">practice under heat</span>
        </div>
      </footer>
    </div>
  );
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

function verdictTier(verdict: string): string {
  if (verdict.length >= VERDICT_LONG_FROM) return "verdict-long";
  if (verdict.length >= VERDICT_MID_FROM) return "verdict-mid";
  return "";
}

function readCategoryScores(value: unknown): CategoryScores | null {
  if (typeof value !== "object" || value === null) return null;
  const { technical, communication, problem_solving } = value as Record<string, unknown>;
  if (
    !Number.isFinite(technical) ||
    !Number.isFinite(communication) ||
    !Number.isFinite(problem_solving)
  ) {
    return null;
  }
  return {
    technical: technical as number,
    communication: communication as number,
    problem_solving: problem_solving as number,
  };
}

function readDeliveryMetrics(value: unknown): DeliveryMetrics | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (
    !Number.isFinite(m.wpm) ||
    !Number.isFinite(m.avg_pause_ms) ||
    !Number.isFinite(m.filler_count)
  ) {
    return null;
  }
  const optional = (v: unknown) => (Number.isFinite(v) ? (v as number) : null);
  const count = (v: unknown) => (Number.isFinite(v) ? (v as number) : 0);
  return {
    wpm: m.wpm as number,
    avg_pause_ms: m.avg_pause_ms as number,
    filler_count: m.filler_count as number,
    pitch_variation: optional(m.pitch_variation),
    energy: optional(m.energy),
    mean_pitch_hz: optional(m.mean_pitch_hz),
    jitter_local: optional(m.jitter_local),
    shimmer_local: optional(m.shimmer_local),
    hnr_db: optional(m.hnr_db),
    uptalk_pct: optional(m.uptalk_pct),
    uptalk_statements: count(m.uptalk_statements),
    uptalk_rising: count(m.uptalk_rising),
    on_camera_pct: optional(m.on_camera_pct),
    smile_pct: optional(m.smile_pct),
    head_motion_dps: optional(m.head_motion_dps),
    camera_turns: count(m.camera_turns),
    response_latency_ms: optional(m.response_latency_ms),
    interruptions: count(m.interruptions),
    articulation_rate_sps: optional(m.articulation_rate_sps),
    speech_rate_sps: optional(m.speech_rate_sps),
    phonation_ratio: optional(m.phonation_ratio),
    trailing_off_pct: optional(m.trailing_off_pct),
    trailing_off_statements: count(m.trailing_off_statements),
    trailing_off_fading: count(m.trailing_off_fading),
    transcriber_confidence: optional(m.transcriber_confidence),
    slouch_pct: optional(m.slouch_pct),
    hands_to_face_pct: optional(m.hands_to_face_pct),
    shoulder_tilt_deg: optional(m.shoulder_tilt_deg),
    wrist_motion: optional(m.wrist_motion),
    posture_turns: count(m.posture_turns),
  };
}

function readPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const point = (item as Record<string, unknown>).point;
    if (typeof point !== "string" || point.trim().length === 0) continue;
    out.push(point.trim());
    if (out.length === POINT_LIMIT) break;
  }
  return out;
}
