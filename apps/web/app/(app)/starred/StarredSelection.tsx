"use client";

import { useState } from "react";
import Link from "next/link";
import type { QuestionType } from "@repo/types";
import { cx } from "@/components/ui";
import { Explain } from "@/components/Explain";
import { Unstar } from "./Unstar";

export interface StarredItem {
  id: string;
  question: string;
  questionType: QuestionType;
  questionHash: string;
  day: string;
  sessionId: string | null;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy turns: `behavioral` and `cultural` always meant the same thing.
  behavioral: "Cultural",
};

const MAX_DRILL = 12;

const CHIP = "font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase text-ink-muted";
const ACT =
  "border border-line px-3 py-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-muted transition-colors hover:border-ember hover:text-ember";

function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

export function StarredSelection({ items }: { items: StarredItem[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const full = picked.length >= MAX_DRILL;

  function toggle(hash: string) {
    setPicked((cur) =>
      cur.includes(hash)
        ? cur.filter((h) => h !== hash)
        : cur.length >= MAX_DRILL
          ? cur
          : [...cur, hash],
    );
  }

  return (
    <>
      <Explain>
        Ticking a question puts it in a drill: the interview asks <b>exactly these</b>, word for
        word, in the order you tick them — with the usual adaptive follow-ups in between.
      </Explain>

      <ol className="ledger">
        {items.map((s) => {
          const at = picked.indexOf(s.questionHash);
          return (
            <StarredRow
              key={s.id}
              item={s}
              position={at === -1 ? null : at + 1}
              disabled={at === -1 && full}
              onToggle={() => toggle(s.questionHash)}
            />
          );
        })}
      </ol>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-3 border border-t-0 border-line bg-paper-sunken px-5 py-3.5">
        <p aria-live="polite" className="font-mono text-[11px] tracking-[0.08em] text-ink-soft">
          {picked.length === 0 ? (
            "Tick the ones you want asked back"
          ) : (
            <>
              <b className="font-medium text-ink">{picked.length} selected</b> · asked in this order
            </>
          )}
        </p>
        <span className="flex-1" />
        {full && (
          <span className={cx(CHIP, "text-ember")}>{MAX_DRILL} is the most a drill can hold</span>
        )}
        {picked.length > 0 ? (
          <Link
            href={`/new?mode=starred&h=${picked.join(",")}`}
            className="btn btn-primary btn-sm max-sm:w-full"
          >
            Drill {picked.length} starred →
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm max-sm:w-full"
            style={{ cursor: "default" }}
            disabled
          >
            Drill starred →
          </button>
        )}
      </div>
    </>
  );
}

/**
 * One kept question.
 *
 * NOT a `.row` link like the dashboard's ledger, and not for lack of trying: the
 * row owns a Remove button, and nesting a button inside a link gives keyboard and
 * screen-reader users a control they can reach but not operate predictably. So
 * the question sits as text and the two actions are their own square chips
 * beside it — which also lets the question wrap to as many lines as it needs
 * instead of being ellipsised into a single grid cell.
 */
function StarredRow({
  item: s,
  position,
  disabled,
  onToggle,
}: {
  item: StarredItem;
  position: number | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = `star-${s.id}`;
  return (
    <li
      className={cx(
        "flex flex-wrap items-start gap-x-5 gap-y-3 border-t border-line px-5 py-4 first:border-t-0",
        position !== null && "bg-(--surface-hover)",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={position !== null}
        disabled={disabled}
        onChange={onToggle}
        className="mt-1.5 size-[15px] shrink-0 accent-ember disabled:opacity-40"
      />

      {/* The star is the whole label for this list — it's the mark you put on
          the question yourself, and it says "saved" faster than a chip does. */}
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-7 text-ember">
        ★
      </span>

      <div className="min-w-0 flex-1 basis-[18rem]">
        <label
          htmlFor={id}
          className={cx(
            "block text-[1.02rem] leading-snug font-medium",
            disabled ? "cursor-not-allowed text-ink-soft" : "cursor-pointer",
          )}
        >
          {s.question}
        </label>
        {position !== null && (
          <p className="mt-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ember">
            Asked {ordinal(position)} in the drill
          </p>
        )}
        {/* Null once the interview it came from is deleted. The star is the
            point; the link back is a bonus, so its absence is quiet. */}
        {s.sessionId ? null : (
          <p className="mt-2 font-mono text-[10px] tracking-[0.12em] uppercase text-ink-muted">
            Interview deleted · the question is still yours
          </p>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Type and date as one mono string rather than a chip plus a date:
            the reference keeps this column to a single quiet line so the
            question is the only thing with weight in the row. */}
        <span className={CHIP}>
          {TYPE_LABEL[s.questionType]} · {s.day}
        </span>
        {s.sessionId ? (
          <Link href={`/report/${s.sessionId}`} className={ACT}>
            See it in context
          </Link>
        ) : null}
        <Unstar questionHash={s.questionHash} />
      </div>
    </li>
  );
}
