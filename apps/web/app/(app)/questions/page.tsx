import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { Reveal } from "@/components/Reveal";
import { ExplainBanner, Explain } from "@/components/Explain";
import { coerceDifficulty, DIFFICULTY_META, SET_SOURCE_META } from "@/lib/interviewMeta";

export const metadata: Metadata = {
  title: "Question bank",
  description: "Generate batches of questions to read and rehearse — no interview attached.",
};
// Sets are created and deleted from sibling pages; never serve a stale list.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same UTC day treatment the dashboard and /starred use, for the same reason. */
function fmtDay(d: Date): string {
  const month = MONTHS[d.getUTCMonth()];
  return month ? `${month} ${d.getUTCDate()}` : d.toISOString().slice(0, 10);
}

export default async function QuestionBankPage() {
  // proxy.ts gates this, but a Server Component reading the DB must never
  // assume that — it re-checks rather than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/questions");

  const sets = await repo.listQuestionSets(userId);

  return (
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            {/* The screen slug. Numbered 03 to match its rail row — this page
                IS part of the practice group, unlike /starred. */}
            <p className="kicker">03 — Question bank</p>
            <h1 className="h1 mt-4 max-w-[16ch]">Questions first. Interview whenever.</h1>
            <p className="page-sub max-w-[54ch]">
              {sets.length ? (
                <>
                  <b>
                    {sets.length} set{sets.length === 1 ? "" : "s"}
                  </b>{" "}
                  generated. Read them cold, then run any of them as a real session when
                  you&rsquo;re ready.
                </>
              ) : (
                "Generate a batch of questions from your résumé, a topic, or culture-fit ground — just the questions, to read at your own pace."
              )}
            </p>
          </div>
          {/* This page's one hot action. Primary is earned here the way it is
              on the dashboard: the whole screen exists to press this. */}
          <Link href="/questions/new" className="btn btn-primary">
            Generate questions
          </Link>
        </div>

        {/* Bare, not wrapped: `display: none` when the mode is off, so a
            spacing wrapper would leave a hole on every other view. */}
        <ExplainBanner />

        {sets.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="rv" data-io>
            <div className="ledger-head">
              <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
                Your sets
              </h2>
              <p className="trend-note">{sets.length} total · newest first</p>
            </div>

            <Explain>
              A set is a <b>document, not a session</b> — nothing is recorded or scored while you
              read it. The &ldquo;practised&rdquo; count only moves when you run a set as an
              interview from its page.
            </Explain>

            <div className="mt-3 border border-line bg-paper-raised">
              {sets.map((s) => {
                const heat = DIFFICULTY_META[coerceDifficulty(s.difficulty)];
                return (
                  <Link
                    key={s.id}
                    href={`/questions/${s.id}`}
                    className="group grid grid-cols-[1fr_auto_auto] items-center gap-x-5 border-b border-line px-6 py-4.5 transition-colors last:border-b-0 hover:bg-(--surface-hover) sm:grid-cols-[1fr_auto_auto_auto_auto_auto]"
                  >
                    <span className="row-t">
                      <span>{s.name}</span>
                      {s.role ? <span className="row-role">{s.role}</span> : null}
                    </span>
                    <span className="chip hidden sm:inline-block">
                      {SET_SOURCE_META[s.source].label}
                    </span>
                    <span
                      className="hidden font-mono text-[10.5px] tracking-[0.12em] uppercase sm:inline"
                      style={{ color: heat.color }}
                    >
                      {heat.label}
                    </span>
                    <span className="row-date">
                      {s._count.items} q{s._count.sessions > 0 ? ` · ${s._count.sessions}× run` : ""}
                    </span>
                    <span className="row-date hidden sm:inline">{fmtDay(s.createdAt)}</span>
                    <span className="row-arrow" aria-hidden="true">
                      →
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

/**
 * Nothing generated yet. Same contract as /starred's empty state: say where
 * sets come from, don't apologise for the blank screen.
 */
function EmptyState() {
  return (
    <section
      className="rv mt-7 border border-line border-l-[3px] border-l-ember bg-paper-raised px-7 py-6"
      data-io
    >
      <p className="mb-3.5 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase">
        How this works
      </p>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        Pick a source — your résumé, a topic, or culture-fit — set the difficulty and how many
        questions you want, and you get exactly that: a numbered list to read, with no interview
        attached and nothing recorded. Every set keeps a &ldquo;run as interview&rdquo; button for
        the day you want to face those questions for real.
      </p>
      <Link href="/questions/new" className="btn btn-ghost btn-sm mt-4">
        Generate your first set →
      </Link>
    </section>
  );
}
