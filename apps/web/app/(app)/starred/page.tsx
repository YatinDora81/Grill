import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { Explain, ExplainBanner } from "@/components/Explain";
import { Reveal } from "@/components/Reveal";
import { StarredSelection, type StarredItem } from "./StarredSelection";

export const metadata: Metadata = {
  title: "Starred",
  description: "Questions you kept — the ones worth rehearsing again.",
};
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(d: Date): string {
  const month = MONTHS[d.getUTCMonth()];
  return month ? `${month} ${d.getUTCDate()}` : d.toISOString().slice(0, 10);
}

export default async function StarredPage() {
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/starred");

  const starred = await repo.listStarredQuestions(userId);
  const items: StarredItem[] = starred.map((s) => ({
    id: s.id,
    question: s.question,
    questionType: s.questionType,
    questionHash: s.questionHash,
    day: fmtDay(s.createdAt),
    sessionId: s.turn?.sessionId ?? null,
  }));

  return (
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
              Saved questions
            </p>
            <h1 className="h1 mt-3.5 max-w-[15ch]">The questions that caught you out</h1>
            <p className="page-sub max-w-[52ch]">
              {starred.length ? (
                <>
                  <b>
                    {starred.length} question{starred.length === 1 ? "" : "s"}
                  </b>{" "}
                  you kept. This is the homework.
                </>
              ) : (
                "Nothing kept yet. Star the ones that catch you out."
              )}
            </p>
          </div>
          <Link href="/new" className="btn btn-secondary">
            New interview
          </Link>
        </div>

        <ExplainBanner />

        {starred.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="rv" data-io>
            <div className="ledger-head">
              <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
                Questions you saved
              </h2>
              <p className="trend-note">{starred.length} saved · newest first</p>
            </div>

            <Explain>
              Starring is the one thing here you do by hand. A question earns a star when it caught
              you out — so this count isn&rsquo;t a score, it&rsquo;s a <b>to-do list</b>. It should
              go down as you drill them, not up.
            </Explain>

            <StarredSelection items={items} />
          </section>
        )}
      </main>
    </>
  );
}

function EmptyState() {
  return (
    <section
      className="rv mt-7 border border-line border-l-[3px] border-l-ember bg-paper-raised px-7 py-6"
      data-io
    >
      <p className="mb-3.5 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase">
        How this fills up
      </p>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        Every report ends with a replay of the questions you were asked. Star the ones that caught
        you out and they land here — and they stay, even if you later delete the interview they came
        from.
      </p>
      <Link href="/dashboard" className="btn btn-ghost btn-sm mt-4">
        Back to your sessions →
      </Link>
    </section>
  );
}
