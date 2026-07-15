import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { RecentSession, SessionStatus } from "@repo/types";
import { getUserId } from "@/lib/auth";
import { getDashboardData } from "@/lib/services/dashboardService";
import { UNTITLED } from "@/lib/interviewMeta";
import { ButtonLink, Card, Eyebrow, cx, scoreTone } from "@/components/ui";
import { Trend } from "./Trend";

export const metadata: Metadata = { title: "Dashboard" };
// Scores change as sessions finish; never serve a cached dashboard.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // proxy.ts already gates this, but a Server Component must never assume that —
  // it reads the DB, so it re-checks rather than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/dashboard");

  const { user, stats, recent } = await getDashboardData(userId);
  const firstName = user.name?.split(" ")[0] ?? null;

  // An unfinished interview outranks everything else on this page: it's the one
  // thing with a deadline attached. Surfacing it also stops the empty state
  // from claiming "nothing here" while the list below shows a live session.
  const resumable = recent.find((s) => s.status === "in_progress") ?? null;
  const scored = stats.completed > 0;
  // The resumable session is featured above; repeating it in the list directly
  // underneath just reads as a duplicate.
  const rest = recent.filter((s) => s.session_id !== resumable?.session_id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">
            {firstName ? `Hello, ${firstName}` : "Your dashboard"}
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scored
              ? `${stats.completed} interview${stats.completed === 1 ? "" : "s"} on the record.`
              : resumable
                ? "You left one on the table."
                : "No interviews yet. The first one is the hardest."}
          </p>
        </div>
        {/* Only ever one ember button per screen — if there's a session to
            resume, that's the hot action and this steps back. */}
        <ButtonLink href="/new" variant={resumable ? "secondary" : "primary"}>
          New interview
        </ButtonLink>
      </div>

      {resumable ? <ResumeCard session={resumable} /> : null}

      {scored ? (
        <>
          <section className="mt-8 grid gap-3 sm:grid-cols-4">
            <Stat label="Completed" value={String(stats.completed)} />
            <Stat label="Average" value={fmtScore(stats.avg_score)} tone={stats.avg_score} />
            <Stat label="Best" value={fmtScore(stats.best_score)} tone={stats.best_score} />
            <Stat label="Latest" value={fmtScore(stats.last_score)} tone={stats.last_score} />
          </section>

          {stats.trend.length > 1 && (
            <Card className="mt-3 p-6">
              <Eyebrow>Progress</Eyebrow>
              <p className="mt-1 text-xs text-ink-muted">Overall score, oldest to newest.</p>
              <div className="mt-5">
                <Trend scores={stats.trend} />
              </div>
            </Card>
          )}
        </>
      ) : null}

      {!scored && !resumable ? <EmptyState /> : null}

      {rest.length > 0 ? (
        <section className="mt-10">
          <Eyebrow>Recent sessions</Eyebrow>
          <ul className="rounded-card mt-3 divide-y divide-line overflow-hidden border border-line bg-paper-raised">
            {rest.map((s) => (
              <SessionRow key={s.session_id} session={s} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function fmtScore(v: number | null): string {
  return v === null ? "—" : String(v);
}

/**
 * What to call a session in a list.
 *
 * The name is the user's own word for it and always wins. Sessions from before
 * names existed fall back to the role, which is what this page used as a title
 * all along — so old rows read exactly as they did yesterday.
 */
function sessionTitle(s: RecentSession): string {
  return s.name?.trim() || s.role?.trim() || UNTITLED;
}

/**
 * The unfinished interview, pulled out of the list. No key-light here: the glow
 * is the hot seat's signature, and spending it on a dashboard card would stop
 * it meaning "you're live". An ember edge is enough to say "open".
 */
function ResumeCard({ session: s }: { session: RecentSession }) {
  return (
    <div className="rounded-card mt-8 flex flex-wrap items-center justify-between gap-4 border border-line border-l-2 border-l-ember bg-paper-raised p-6">
      <div className="min-w-0">
        <Eyebrow tone="ember">Still open</Eyebrow>
        <p className="mt-2 truncate font-display text-xl">{sessionTitle(s)}</p>
        <p className="mt-1 font-mono text-xs text-ink-muted">
          Started {s.date}
          {s.name && s.role ? ` · ${s.role}` : ""} · not scored until you finish
        </p>
      </div>
      <ButtonLink href={`/session/${s.session_id}`}>Resume</ButtonLink>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  const toneClass =
    tone === null || tone === undefined
      ? "text-ink"
      : { strong: "text-strong", mixed: "text-mixed", weak: "text-weak" }[scoreTone(tone)];
  return (
    <Card className="p-5">
      <Eyebrow>{label}</Eyebrow>
      <p className={cx("tabular mt-2 font-display text-3xl", toneClass)}>{value}</p>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="mt-8 p-8 text-center">
      <h2 className="font-display text-2xl">Nothing to show yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
        Run an interview and you&apos;ll get a scored report grounded in your own words —
        plus how you actually sounded saying them.
      </p>
      <div className="mt-5 flex justify-center">
        <ButtonLink href="/new">Start your first interview</ButtonLink>
      </div>
    </Card>
  );
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  in_progress: "In progress",
  generating_report: "Building report",
  completed: "Completed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  error: "Failed",
};

function SessionRow({ session: s }: { session: RecentSession }) {
  // An in-progress one resumes; everything else that has (or is getting) a
  // report goes to the report page.
  //
  // `generating_report` and `error` MUST be reachable. The thank-you screen
  // drops the candidate here five seconds after their last answer, while the
  // report is still building — if this row weren't a link, the report they're
  // waiting for would be unreachable from the only page they were sent to. The
  // report page handles both: it polls while building, and re-kicks a failed one.
  const href =
    s.status === "in_progress"
      ? `/session/${s.session_id}`
      : s.status === "completed" || s.status === "generating_report" || s.status === "error"
        ? `/report/${s.session_id}`
        : null;

  const body = (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{sessionTitle(s)}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-ink-muted">
          {s.date} · {STATUS_LABEL[s.status]}
          {s.name && s.role ? ` · ${s.role}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {s.score !== null ? (
          <span
            className={cx(
              "tabular font-display text-2xl",
              { strong: "text-strong", mixed: "text-mixed", weak: "text-weak" }[
                scoreTone(s.score)
              ],
            )}
          >
            {s.score}
          </span>
        ) : null}
        {href ? (
          <span
            aria-hidden
            className="text-ink-muted transition-colors group-hover:text-ember"
          >
            →
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} className="group block transition-colors hover:bg-paper-sunken">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
