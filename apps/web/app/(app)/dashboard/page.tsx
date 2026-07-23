import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { RecentSession, SessionStatus } from "@repo/types";
import { getUserId } from "@/lib/auth";
import { getDashboardData } from "@/lib/services/dashboardService";
import { UNTITLED } from "@/lib/interviewMeta";
import { cx, scoreTone } from "@/components/ui";
import { Reveal } from "@/components/Reveal";
import { Trend } from "./Trend";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your recent interviews, scores and where the trend is going.",
};
// Scores change as sessions finish; never serve a cached dashboard.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // proxy.ts already gates this, but a Server Component must never assume that —
  // it reads the DB, so it re-checks rather than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/dashboard");

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
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            <h1 className="h1">
              {firstName ? (
                <>
                  Hello, <i>{firstName}.</i>
                </>
              ) : (
                "Your dashboard"
              )}
            </h1>
            <p className="page-sub">
              {scored ? (
                <>
                  <b>
                    {stats.completed} interview{stats.completed === 1 ? "" : "s"}
                  </b>{" "}
                  on the record.
                  {resumable ? " One still on the burner." : ""}
                </>
              ) : resumable ? (
                "You left one on the table."
              ) : (
                "No interviews yet. The first one is the hardest."
              )}
            </p>
          </div>
          {/* Only ever one ember button per screen — if there's a session to
              resume, that's the hot action and this steps back. */}
          <Link href="/new" className={cx("btn", resumable ? "btn-secondary" : "btn-primary")}>
            New interview
          </Link>
        </div>

        {resumable ? <ResumeCard session={resumable} /> : null}

        {scored ? (
          <>
            <section className="stats rv" data-io aria-label="Your numbers">
              <Stat label="Completed" value={stats.completed} unit={false} />
              <Stat label="Average" value={stats.avg_score} />
              <Stat label="Best" value={stats.best_score} />
              <Stat label="Latest" value={stats.last_score} />
            </section>

            {stats.trend.length > 1 && (
              <section className="trend rv" data-io>
                <div className="trend-head">
                  <p className="kicker">Progress</p>
                  {/* "tap" rather than "hover" on purpose: the touch user is
                      the one who can't discover this, and a mouse user reads
                      "tap" as "click" and hovers anyway. */}
                  <p className="trend-note">overall score · oldest → newest · tap a point</p>
                </div>
                <Trend scores={stats.trend} />
              </section>
            )}
          </>
        ) : null}

        {!scored && !resumable ? <EmptyState /> : null}

        {rest.length > 0 ? (
          <section className="rv" data-io>
            <div className="ledger-head">
              <p className="kicker">Recent sessions</p>
              <p className="trend-note">{rest.length} shown</p>
            </div>
            <div className="ledger">
              {rest.map((s) => (
                <SessionRow key={s.session_id} session={s} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;

/** Score → verdict class, or nothing at all when there is no score to colour. */
function tone(v: number | null): string {
  return v === null ? "" : TONE_CLASS[scoreTone(v)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-07-20` → `Jul 20`. Sliced rather than handed to Date: the string is
 * already the date we mean, and parsing it would reinterpret it in whatever
 * timezone the renderer happens to sit in — which moves half the rows a day.
 */
function fmtDay(iso: string): string {
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  if (!month) return iso;
  return `${month} ${Number(iso.slice(8, 10))}`;
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
 * The unfinished interview, pulled out of the list and given the one ember
 * button on the page: it is the only thing here with a deadline attached.
 */
function ResumeCard({ session: s }: { session: RecentSession }) {
  const detail = [
    s.name?.trim() && s.role?.trim() ? s.role.trim() : null,
    `started ${fmtDay(s.date)}`,
    "not scored until you finish",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="resume rv" data-io aria-label="Interview in progress">
      <div style={{ minWidth: 0 }}>
        <p className="resume-label">
          <span className="live-dot" aria-hidden="true" />
          Still on the burner
        </p>
        <h2 className="resume-t">{sessionTitle(s)}</h2>
        <p className="resume-d">{detail}</p>
      </div>
      <Link href={`/session/${s.session_id}`} className="btn btn-primary">
        Back to the hot seat
      </Link>
    </section>
  );
}

function Stat({
  label,
  value,
  unit = true,
}: {
  label: string;
  value: number | null;
  /** Completed is a count, not a score — it has no denominator. */
  unit?: boolean;
}) {
  return (
    <div className="stat">
      <p className="stat-k">{label}</p>
      <p className={cx("stat-v", unit ? tone(value) : "")}>
        {value === null ? "—" : value}
        {unit && value !== null ? <small>/100</small> : null}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty rv" data-io>
      <h2>No interviews yet. The first one is the hardest.</h2>
      <p>
        Run one and you&apos;ll get a scored report grounded in your own words — plus how
        you actually sounded saying them.
      </p>
    </div>
  );
}

/** Non-completed statuses read as a chip rather than a score they don't have. */
const STATUS_CHIP: Record<SessionStatus, { label: string; className: string }> = {
  in_progress: { label: "in progress", className: "chip-gen" },
  generating_report: { label: "report cooking", className: "chip-gen" },
  completed: { label: "completed", className: "" },
  cancelled: { label: "cancelled", className: "" },
  abandoned: { label: "abandoned", className: "" },
  error: { label: "error", className: "chip-error" },
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

  const chip = STATUS_CHIP[s.status];

  const body = (
    <>
      <span className="row-t">
        <span>{sessionTitle(s)}</span>
        {s.name?.trim() && s.role?.trim() ? <span className="row-role">{s.role}</span> : null}
      </span>
      <span className="row-date">{fmtDay(s.date)}</span>
      {s.status === "completed" && s.score !== null ? (
        <span className={cx("row-score", tone(s.score))}>{s.score}</span>
      ) : (
        <span className={cx("chip", chip.className)}>{chip.label}</span>
      )}
      <span className="row-arrow" aria-hidden="true">
        {href ? "→" : ""}
      </span>
    </>
  );

  // Cancelled and abandoned sessions have nothing to open — a row that looks
  // like a link and does nothing is worse than one that plainly doesn't.
  //
  // No `aria-label`: it would replace the row's own text as the accessible
  // name, so a screen reader would hear the title and lose the date, the score
  // and the status — everything the row is actually for.
  return href ? (
    <Link href={href} className="row">
      {body}
    </Link>
  ) : (
    <div className="row">{body}</div>
  );
}
