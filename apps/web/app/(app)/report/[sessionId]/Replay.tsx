import type { QuestionFeedback, QuestionType } from "@repo/types";
import { Card, Eyebrow, cx } from "@/components/ui";
import { PlayAnswer } from "./PlayAnswer";
import { WatchAnswer } from "./WatchAnswer";
import { StarQuestion } from "./StarQuestion";

export interface ReplayTurn {
  turn_id: string;
  turn_index: number;
  question: string;
  question_type: QuestionType;
  transcript: string | null;
  has_audio: boolean;
  /** The session recording this answer is in, if there was a camera. */
  video_id: string | null;
  video_offset_ms: number | null;
  /** Computed server-side so the star paints correctly on first render. */
  question_hash: string;
  starred: boolean;
  feedback: QuestionFeedback | null;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy turns: `behavioral` and `cultural` always meant the same thing.
  behavioral: "Cultural",
};

/**
 * The whole interview, in order: what was asked, what you actually said, and
 * the recording. Per-question coaching (possible answers + improvements) sits
 * in accordions under each turn when the report has them.
 */
export function Replay({ sessionId, turns }: { sessionId: string; turns: ReplayTurn[] }) {
  if (!turns.length) return null;

  return (
    <section className="mt-10">
      <Eyebrow>Replay · the whole interview</Eyebrow>
      <ol className="mt-3 space-y-3">
        {turns.map((t) => (
          <Card key={t.turn_index} className="p-5">
            {/* Flat and wrapping, rather than a nested `shrink-0` cluster:
                WatchAnswer's open player is a sibling here, so `w-full` on it
                resolves against the Card and it wraps to its own line. `mr-auto`
                on the eyebrow is what still holds the controls to the right. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="mr-auto font-mono text-[11px] tracking-[0.16em] text-ember uppercase">
                {String(t.turn_index + 1).padStart(2, "0")} · {TYPE_LABEL[t.question_type]}
              </span>
              <StarQuestion turnId={t.turn_id} questionHash={t.question_hash} initial={t.starred} />
              {t.has_audio ? (
                <PlayAnswer sessionId={sessionId} turnIndex={t.turn_index} />
              ) : (
                <span className="font-mono text-[11px] text-ink-muted">typed</span>
              )}
              {/* Only where a recording actually covers this answer. A denied
                  camera, or a session from before video existed, simply has no
                  Watch button rather than a broken one. */}
              {t.video_id && t.video_offset_ms !== null ? (
                <WatchAnswer videoId={t.video_id} offsetMs={t.video_offset_ms} />
              ) : null}
            </div>

            <p className="mt-3 font-display text-lg leading-snug">{t.question}</p>

            <p
              className={cx(
                "mt-3 border-l-2 border-line pl-4 text-sm leading-relaxed",
                t.transcript ? "text-ink-soft" : "text-ink-muted italic",
              )}
            >
              {t.transcript || "No answer recorded."}
            </p>

            <TurnCoaching feedback={t.feedback} />
          </Card>
        ))}
      </ol>
    </section>
  );
}

function TurnCoaching({ feedback }: { feedback: QuestionFeedback | null }) {
  if (!feedback) return null;
  const answers = feedback.possible_answers.filter(Boolean);
  const improvements = feedback.improvements.filter(Boolean);
  if (!answers.length && !improvements.length) return null;

  return (
    <div className="mt-4 space-y-2">
      {answers.length > 0 ? (
        <details className="group rounded-xl border border-line bg-paper-sunken/40 open:bg-paper-sunken/60">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-soft marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-3">
              Possible answers
              <span className="font-mono text-[11px] text-ink-muted group-open:hidden">show</span>
              <span className="hidden font-mono text-[11px] text-ink-muted group-open:inline">
                hide
              </span>
            </span>
          </summary>
          <ul className="space-y-3 border-t border-line px-4 py-3">
            {answers.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
                <span className="shrink-0 font-mono text-[11px] text-ember">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {improvements.length > 0 ? (
        <details className="group rounded-xl border border-line bg-paper-sunken/40 open:bg-paper-sunken/60">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-soft marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-3">
              How to improve your answer
              <span className="font-mono text-[11px] text-ink-muted group-open:hidden">show</span>
              <span className="hidden font-mono text-[11px] text-ink-muted group-open:inline">
                hide
              </span>
            </span>
          </summary>
          <ul className="space-y-3 border-t border-line px-4 py-3">
            {improvements.map((tip, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
                <span className="shrink-0 font-mono text-[11px] text-ember">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
