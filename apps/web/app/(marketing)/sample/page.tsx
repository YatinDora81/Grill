import type { Metadata } from "next";
import Link from "next/link";
import type { AnswerHighlight } from "@repo/types";
import { OG_IMAGE } from "@/lib/siteMeta";
import { SAMPLE_REPORT, SAMPLE_SESSION, SAMPLE_TURNS } from "@/lib/fixtures/sampleReport";
import { DIFFICULTY_META } from "@/lib/interviewMeta";
import { BAND_LABEL, ButtonLink, cx, scoreBand, scoreTone } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { ScoreBand } from "@/components/ScoreBand";
import { Delivery } from "@/app/(app)/report/[sessionId]/Delivery";
import { Replay } from "@/app/(app)/report/[sessionId]/Replay";

const DESCRIPTION =
  "A real Grill report, start to finish: the score, the delivery measured from the audio, and every answer replayed word by word. It scores 72, not 100 — that is the point.";

export const metadata: Metadata = {
  title: "Sample report",
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/sample" },
  openGraph: {
    url: "/sample",
    title: "A Grill verdict you can read before signing up",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export const dynamic = "force-static";

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;
const tone = (v: number) => TONE_CLASS[scoreTone(v)];

const FIX_LIMIT = 3;
const FIX_TITLE_MAX = 64;
const VERDICT_MID_FROM = 56;
const VERDICT_LONG_FROM = 112;

export default function SamplePage() {
  const report = SAMPLE_REPORT;
  const cats = report.category_scores;
  const fixes = report.next_steps.slice(0, FIX_LIMIT);
  const turns = SAMPLE_TURNS;

  const meta = [
    new Date(report.created_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    `${turns.length} questions · ${DIFFICULTY_META[SAMPLE_SESSION.config.difficulty].label}`,
    SAMPLE_SESSION.role,
  ];

  return (
    <div className="app-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight keylight-report" aria-hidden="true" />

      <main className="wrap report-main">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border border-dashed border-line-strong bg-paper-raised px-4 py-3.5 sm:mt-8">
          <p className="font-mono text-[0.66rem] leading-relaxed tracking-[0.13em] uppercase text-ink-muted">
            <span className="text-ember">Sample verdict.</span> Every word below belongs to someone
            else — <span className="text-ink">yours gets your own.</span>
          </p>
          <ButtonLink href="/signup" size="sm">
            Take the hot seat
          </ButtonLink>
        </div>

        <ExplainBanner />

        <section aria-label="The verdict">
          <header className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div style={{ minWidth: 0, flex: "1 1 340px" }}>
              <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
                Report — {SAMPLE_SESSION.name}
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
            </div>

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

        <section className="section" aria-label="Fix these">
          <SectionHead title="Fix these things" note="ranked · biggest gain first" />
          <div className="mt-4 grid border-t border-l border-line md:grid-cols-3">
            {fixes.map((s, i) => {
              const { title, body } = splitFix(s);
              return (
                <div className="border-r border-b border-line p-6" key={i}>
                  <p className="font-display text-[1.6rem] leading-none font-bold text-ember">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  {title ? (
                    <p className="mt-3.5 font-mono text-[0.72rem] leading-normal tracking-[0.1em] uppercase text-ink">
                      {title}
                    </p>
                  ) : null}
                  {body ? (
                    <p className="mt-2.5 text-[0.89rem] leading-relaxed text-ink-soft">{body}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mono-note" style={{ marginTop: 14 }}>
            top {fixes.length} of {report.next_steps.length} · the rest ranked lower
          </p>
        </section>

        <section className="section" aria-label="How you sounded">
          <SectionHead title="How you sounded" note="measured from the recording · never guessed" />
          <Delivery metrics={report.delivery_metrics} />
        </section>

        <section className="section" aria-label="Best & worst">
          <SectionHead title="Your best and worst answer" note="straight from your own recording" />
          <div className="mt-4 grid border-t border-l border-line md:grid-cols-2">
            {report.best_answer ? (
              <Highlight label="Strongest answer" variant="strong" h={report.best_answer} />
            ) : null}
            {report.worst_answer ? (
              <Highlight label="Weakest answer" variant="weak" h={report.worst_answer} />
            ) : null}
          </div>

          <div className="mt-12">
            <p className="kicker">What worked</p>
            {report.strengths.map((s, i) => (
              <div className="point" key={i}>
                <p className="point-t">{s.point}</p>
                <p className="quote quote-strong">“{s.example}”</p>
              </div>
            ))}
          </div>

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
        </section>

        <div role="region" aria-label="Every question" className="section">
          <SectionHead
            title="Every question, one by one"
            note="what you said · why it scored · what to say instead"
          />
          <Replay
            readOnly
            sessionId={report.session_id}
            defaultOpenIndex={turns.findIndex((t) => t.transcript_words !== null)}
            turns={turns}
          />
          <Explain>
            Two of these answers keep their <b>word timings</b>, so the transcript is tinted where
            the fillers actually fell. On your own report the words light up in time with the
            recording and you can click any one of them to hear it back.
          </Explain>
        </div>

        <div className="endrow">
          <div>
            <ButtonLink href="/signup">Take the hot seat</ButtonLink>
            <p className="mono-note" style={{ marginTop: 8 }}>
              free · 8 questions · no card
            </p>
          </div>
          <Link href="/" className="underlink">
            back to grill
          </Link>
        </div>
      </main>
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

function Highlight({
  label,
  variant,
  h,
}: {
  label: string;
  variant: "strong" | "weak";
  h: AnswerHighlight;
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
    </div>
  );
}

function verdictTier(verdict: string): string {
  if (verdict.length >= VERDICT_LONG_FROM) return "verdict-long";
  if (verdict.length >= VERDICT_MID_FROM) return "verdict-mid";
  return "";
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
