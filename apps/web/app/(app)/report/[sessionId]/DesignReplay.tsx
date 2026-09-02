"use client";

import { useState } from "react";
import { Explain } from "@/components/Explain";

export interface DesignReplayReview {
  summary: string;
  components: string[];
  missing: string[];
  single_points_of_failure: string[];
  scale_concerns: string[];
  follow_up_question: string;
  activity: {
    first_edit_ms: number | null;
    longest_idle_ms: number;
    final_elements: number;
  } | null;
}

export interface DesignReplayTurn {
  turn_index: number;
  title: string;
  review: DesignReplayReview;
  image_url: string | null;
}

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function DesignReplay({ turns }: { turns: DesignReplayTurn[] }) {
  if (!turns.length) return null;

  return (
    <section style={{ marginTop: 28 }}>
      <p className="kicker">The board you drew</p>
      <div style={{ marginTop: 8 }}>
        {turns.map((t) => (
          <Board key={t.turn_index} turn={t} />
        ))}
      </div>
      <Explain>
        The diagram below is <b>the board exactly as you left it</b>, exported when you submitted.
        The lists next to it name only what the reviewer could see drawn or heard you say — nothing
        was assumed. The shape count and timings were <b>measured on the board itself</b>.
      </Explain>
    </section>
  );
}

function Board({ turn }: { turn: DesignReplayTurn }) {
  const [open, setOpen] = useState(false);
  const r = turn.review;
  const n = turn.turn_index + 1;

  return (
    <div className="turn" data-open={open}>
      <button
        type="button"
        className="turn-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="turn-n" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <span className="turn-q">{turn.title}</span>
        <span className="turn-type">
          {r.components.length} {r.components.length === 1 ? "component" : "components"}
        </span>
        <span
          className={
            "grid size-6 flex-none place-items-center border text-[0.8rem] leading-none transition-colors " +
            (open ? "border-ember/40 text-ember" : "border-line text-ink-muted")
          }
          aria-hidden="true"
        >
          {open ? "–" : "+"}
        </span>
      </button>

      {open && (
        <div className="turn-body">
          {turn.image_url ? (
            <div>
              <p className="tr-label">The diagram</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="design-shot" src={turn.image_url} alt={`Whiteboard: ${turn.title}`} />
            </div>
          ) : (
            <p className="mono-note">the diagram has been purged or was never stored</p>
          )}

          {r.summary ? (
            <div>
              <p className="tr-label">What the board shows</p>
              <p className="mt-1.5 border-l-2 border-(--track-strong) py-1 pl-3 text-[0.84rem] leading-relaxed text-ink-soft">
                {r.summary}
              </p>
            </div>
          ) : null}

          <Lines label="Components on the board" items={r.components} />
          <Lines label="Missing" items={r.missing} />
          <Lines label="Single points of failure" items={r.single_points_of_failure} />
          <Lines label="Where it stops scaling" items={r.scale_concerns} />

          {r.follow_up_question ? (
            <div>
              <p className="tr-label">What they asked next</p>
              <p className="mt-1.5 border-l-2 border-(--track-strong) py-1 pl-3 text-[0.84rem] leading-relaxed text-ink-soft">
                {r.follow_up_question}
              </p>
            </div>
          ) : null}

          {r.activity ? <Facts activity={r.activity} /> : null}
        </div>
      )}
    </div>
  );
}

function Lines({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="tr-label">{label}</p>
      <ul className="mt-1.5 grid gap-1">
        {items.map((item, i) => (
          <li
            key={i}
            className="border-l-2 border-line py-1 pl-3 text-[0.84rem] leading-relaxed text-ink-soft"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Facts({ activity }: { activity: NonNullable<DesignReplayReview["activity"]> }) {
  const facts: [string, string][] = [
    [
      "first shape",
      activity.first_edit_ms === null ? "never drew" : seconds(activity.first_edit_ms),
    ],
    ["longest pause", seconds(activity.longest_idle_ms)],
    ["shapes at the end", String(activity.final_elements)],
  ];

  return (
    <div>
      <p className="tr-label" style={{ marginBottom: 8 }}>
        Measured while you drew
      </p>
      <div className="rubric">
        {facts.map(([label, value]) => (
          <div key={label}>
            <p className="rub-k">{label}</p>
            <p className="rub-v">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
