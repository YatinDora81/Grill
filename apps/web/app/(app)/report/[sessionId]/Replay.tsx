import type { QuestionType } from "@repo/types";
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
 * the recording. The scores tell you how it went; this is the only place that
 * shows you *what you said* — which is the thing worth re-reading.
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
          </Card>
        ))}
      </ol>
    </section>
  );
}
