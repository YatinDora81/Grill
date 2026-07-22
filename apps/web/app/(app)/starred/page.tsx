import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { QuestionType } from "@repo/types";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { ButtonLink, Card, cx } from "@/components/ui";
import { Unstar } from "./Unstar";

export const metadata: Metadata = {
  title: "Starred",
  description: "Questions you kept — the ones worth rehearsing again.",
};
// Stars change from the report page; never serve a stale collection.
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy turns: `behavioral` and `cultural` always meant the same thing.
  behavioral: "Cultural",
};

export default async function StarredPage() {
  // proxy.ts gates this, but a Server Component reading the DB must never
  // assume that — it re-checks rather than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/starred");

  const starred = await repo.listStarredQuestions(userId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Starred</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {starred.length
              ? "The questions you kept. Worth re-reading before the real thing."
              : "Nothing starred yet."}
          </p>
        </div>
        <ButtonLink href="/new" variant="secondary" size="sm">
          New interview
        </ButtonLink>
      </div>

      {!starred.length ? (
        <Card className="mt-8 p-8 text-center">
          <p className="text-sm leading-relaxed text-ink-soft">
            Star a question from any report&apos;s replay and it lands here — even if you later
            delete the interview it came from.
          </p>
        </Card>
      ) : (
        <ol className="mt-8 space-y-3">
          {starred.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="mr-auto font-mono text-[11px] tracking-[0.16em] text-ember uppercase">
                  {TYPE_LABEL[s.questionType]}
                </span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {s.createdAt.toISOString().slice(0, 10)}
                </span>
                <Unstar questionHash={s.questionHash} />
              </div>

              <p className="mt-3 font-display text-lg leading-snug">{s.question}</p>

              {/* Null once the interview it came from is deleted. The star is
                  the point; the link back is a bonus, so its absence is quiet. */}
              {s.turn ? (
                <Link
                  href={`/report/${s.turn.sessionId}`}
                  className={cx(
                    "mt-3 inline-block text-xs text-ink-muted underline underline-offset-4",
                    "transition-colors hover:text-ember",
                  )}
                >
                  See it in context →
                </Link>
              ) : (
                <p className="mt-3 text-xs text-ink-muted italic">
                  The interview this came from is gone — the question is still yours.
                </p>
              )}
            </Card>
          ))}
        </ol>
      )}
    </main>
  );
}
