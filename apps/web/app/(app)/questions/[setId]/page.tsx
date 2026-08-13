import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { QuestionType, SessionStatus } from "@repo/types";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { Reveal } from "@/components/Reveal";
import { Explain, ExplainBanner } from "@/components/Explain";
import { cx } from "@/components/ui";
import { coerceDifficulty, DIFFICULTY_META, SET_SOURCE_META } from "@/lib/interviewMeta";
import { SetActions } from "./SetActions";

export const metadata: Metadata = { title: "Question set" };
// The practised count and runs list move whenever an interview is started
// from here; never serve them stale.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(d: Date): string {
  const month = MONTHS[d.getUTCMonth()];
  return month ? `${month} ${d.getUTCDate()}` : d.toISOString().slice(0, 10);
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy value; reads as cultural everywhere.
  behavioral: "Cultural",
};

/** Same status→destination rule the dashboard rows use, restated for runs. */
function runHref(id: string, status: SessionStatus): string | null {
  if (status === "in_progress") return `/session/${id}`;
  if (status === "completed" || status === "generating_report" || status === "error") {
    return `/report/${id}`;
  }
  return null;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  in_progress: "In progress",
  generating_report: "Building report",
  completed: "Completed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  error: "Error",
};

export default async function QuestionSetPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/questions");

  const { setId } = await params;
  // A malformed id is a 404, not a Prisma error page.
  if (!UUID.test(setId)) notFound();

  const set = await repo.getQuestionSet(setId, userId);
  if (!set) notFound();

  const [items, runs] = await Promise.all([
    repo.getQuestionSetItems(setId),
    repo.listSetSessions(setId, userId),
  ]);

  const heat = DIFFICULTY_META[coerceDifficulty(set.difficulty)];

  return (
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            <p className="kicker">
              <Link href="/questions" className="transition-colors hover:text-ink">
                03 — Question bank
              </Link>
            </p>
            <h1 className="h1 mt-4 max-w-[22ch]">{set.name}</h1>
            {/* The set's whole brief on one mono line, the way the room labels
                its facts — this page is a document, and a document states its
                edition. */}
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[0.66rem] tracking-[0.12em] uppercase text-ink-muted">
              <span>{SET_SOURCE_META[set.source].label}</span>
              <span aria-hidden="true">·</span>
              <span style={{ color: heat.color }}>{heat.label}</span>
              <span aria-hidden="true">·</span>
              <span>
                {items.length} question{items.length === 1 ? "" : "s"}
              </span>
              {set.role ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{set.role}</span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <span>{fmtDay(set.createdAt)}</span>
            </p>
          </div>
        </div>

        <ExplainBanner />

        <SetActions setId={set.id} questionCount={items.length} />

        {/* ── The questions ─────────────────────────────────────── */}
        <section className="rv" data-io>
          <div className="ledger-head">
            <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
              The questions
            </h2>
            <p className="trend-note">read at your own pace · nothing is recorded</p>
          </div>

          <Explain>
            This list is the deliverable — there is no timer, no mic and no score on this page.
            When you run it as an interview, these exact questions are asked back{" "}
            <b>word for word, in this order</b>.
          </Explain>

          <ol className="mt-3 border border-line bg-paper-raised">
            {items.map((q) => (
              <li
                key={q.id}
                className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 border-b border-line px-6 py-4.5 last:border-b-0 sm:grid-cols-[auto_1fr_auto]"
              >
                {/* The index is the reading anchor — mono, muted, two digits so
                    the column holds its width past question nine. */}
                <span className="font-mono text-[0.7rem] tracking-[0.08em] text-ink-muted tabular-nums">
                  {String(q.itemIndex + 1).padStart(2, "0")}
                </span>
                <span className="text-[0.97rem] leading-relaxed text-ink">{q.question}</span>
                <span className="font-mono text-[0.6rem] tracking-[0.12em] whitespace-nowrap text-ink-muted uppercase max-sm:hidden">
                  {TYPE_LABEL[q.questionType]}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Runs on this set ──────────────────────────────────── */}
        {runs.length > 0 ? (
          <section className="rv" data-io>
            <div className="ledger-head">
              <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
                Interviews on this set
              </h2>
              <p className="trend-note">
                {runs.length} run{runs.length === 1 ? "" : "s"} · newest first
              </p>
            </div>

            <div className="mt-3 border border-line bg-paper-raised">
              {runs.map((r) => {
                const href = runHref(r.id, r.status as SessionStatus);
                const body = (
                  <>
                    <span className="row-t">
                      <span>{r.name ?? "Untitled interview"}</span>
                    </span>
                    <span className="row-date">{fmtDay(r.createdAt)}</span>
                    <span
                      className={cx(
                        "font-mono text-[0.62rem] tracking-[0.12em] uppercase",
                        r.status === "completed" ? "text-strong" : "text-ink-muted",
                      )}
                    >
                      {r.status === "completed" && r.report
                        ? `${r.report.overallScore}/100`
                        : STATUS_LABEL[r.status as SessionStatus]}
                    </span>
                    <span className="row-arrow" aria-hidden="true">
                      {href ? "→" : ""}
                    </span>
                  </>
                );
                const shell =
                  "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 border-b border-line px-6 py-4 last:border-b-0 transition-colors";
                // Cancelled/abandoned runs have nothing to open — same rule as
                // the dashboard: a dead link is worse than plainly none.
                return href ? (
                  <Link key={r.id} href={href} className={cx(shell, "group hover:bg-(--surface-hover)")}>
                    {body}
                  </Link>
                ) : (
                  <div key={r.id} className={shell}>
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
