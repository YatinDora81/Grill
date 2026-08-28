import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { DashboardStats, QuestionType, RecentSession, SessionStatus } from "@repo/types";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { getDashboardData } from "@/lib/services/dashboardService";
import { UNTITLED } from "@/lib/interviewMeta";
import { BAND_LABEL, cx, scoreBand, scoreTone } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { ScoreBand } from "@/components/ScoreBand";
import { Reveal } from "@/components/Reveal";
import { Trend } from "./Trend";
import { Readout } from "./Readout";
import { DeliverySpark } from "./DeliverySpark";
import { RetryChain } from "./RetryChain";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your recent interviews, scores and where the trend is going.",
};
export const dynamic = "force-dynamic";

const STARRED_PREVIEW = 3;

const BTN =
  "inline-flex min-h-[52px] items-center justify-center gap-3 border border-ink bg-ink px-8 font-mono text-[0.8rem] font-semibold tracking-[0.14em] text-paper uppercase transition-colors hover:border-ember hover:bg-ember";
const BTN_SM =
  "inline-flex min-h-10 items-center justify-center gap-2 border border-ink bg-ink px-4 font-mono text-[0.7rem] font-semibold tracking-[0.14em] text-paper uppercase transition-colors";
const TAG =
  "border px-2 py-1 font-mono text-[0.58rem] tracking-[0.14em] whitespace-nowrap uppercase";

export default async function DashboardPage() {
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/dashboard");

  const [{ stats, recent, delivery_series, retry_chain }, starred] = await Promise.all([
    getDashboardData(userId),
    repo.listStarredQuestions(userId),
  ]);

  const resumable = recent.find((s) => s.status === "in_progress") ?? null;
  const scored = stats.completed > 0;
  const rest = recent.filter((s) => s.session_id !== resumable?.session_id);

  return (
    <>
      <Reveal threshold={0.12} />

      <main className="wrap pb-14">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-8 border-b border-line pt-10 pb-7">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] text-ember uppercase">
              01 — Dashboard
            </p>
            <h1 className="h1 mt-3">
              Are you actually
              <br />
              getting better?
            </h1>
            <p className="mt-3.5 max-w-[52ch] text-[0.95rem] leading-relaxed text-ink-soft">
              {scored
                ? "Every mock interview you've run, what changed since the first one, and the questions you still owe yourself an answer to."
                : "Nothing on the record yet. The first interview is the hardest — and it's the only thing that can answer that question."}
            </p>
          </div>
          <Link href="/new" className={BTN}>
            Start a session
            <span aria-hidden="true">+</span>
          </Link>
        </header>

        <ExplainBanner />

        {scored || !resumable ? (
          <Readout
            topPattern={stats.top_pattern}
            latestScore={stats.last_score}
            firstScore={stats.first_score}
            sessionCount={stats.completed}
          />
        ) : null}

        {resumable ? <ResumeBar session={resumable} /> : null}

        <DrillStrip cardsDue={stats.cards_due} streakDays={stats.streak_days} />

        {scored ? (
          <>
            <Kpis stats={stats} />

            {stats.trend.length > 1 && (
              <section className="rv mt-7 border border-line" data-io>
                <div className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-3.5 font-mono text-[0.62rem] tracking-[0.2em] text-ink-muted uppercase">
                  <b className="font-medium text-ink">Verdict, session by session</b>
                  <span className="max-sm:hidden">{stats.trend.length} scored · tap a point</span>
                </div>
                <div className="px-6 pt-3 pb-4">
                  <Trend scores={stats.trend} />
                  <Explain className="mt-3">
                    One point per scored session, left to right in the order you sat them. The line
                    moving up is the only signal here that isn&rsquo;t about a single interview —
                    though a jump of five or ten points between two runs is usually the questions
                    being kinder, not you improving.{" "}
                    <b>The shape over five or six sessions is the part worth reading.</b>
                  </Explain>
                </div>
              </section>
            )}

            <DeliverySpark series={delivery_series} />
            <RetryChain chain={retry_chain} />
          </>
        ) : null}

        {rest.length > 0 ? (
          <section className="rv" data-io>
            <SecHead meta={`${rest.length} shown · newest first`}>Past sessions</SecHead>
            <div className="border border-line">
              {rest.map((s) => (
                <SessionRow key={s.session_id} session={s} />
              ))}
            </div>
          </section>
        ) : null}

        {starred.length > 0 ? <StarredPreview starred={starred} /> : null}
      </main>
    </>
  );
}

function SecHead({ children, meta }: { children: React.ReactNode; meta: string }) {
  return (
    <div className="mt-11 mb-4 flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-3">
      <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
        {children}
      </h2>
      <p className="font-mono text-[0.62rem] tracking-[0.16em] text-ink-muted uppercase">{meta}</p>
    </div>
  );
}

const TILE_TONE = {
  strong: "border-strong/45 text-strong",
  mixed: "border-mixed/45 text-mixed",
  weak: "border-weak/45 text-weak",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(iso: string): string {
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  if (!month) return iso;
  return `${month} ${Number(iso.slice(8, 10))}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 36e5;
const DAY_MS = 864e5;

function fmtAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < MINUTE_MS) return "moments ago";
  const [n, unit]: [number, string] =
    ms < HOUR_MS
      ? [Math.floor(ms / MINUTE_MS), "minute"]
      : ms < DAY_MS
        ? [Math.floor(ms / HOUR_MS), "hour"]
        : [Math.floor(ms / DAY_MS), "day"];
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

function sessionTitle(s: RecentSession): string {
  return s.name?.trim() || s.role?.trim() || UNTITLED;
}

function ResumeBar({ session: s }: { session: RecentSession }) {
  const p = s.progress;
  const detail = [
    s.name?.trim() && s.role?.trim() ? s.role.trim() : null,
    p === null
      ? null
      : p.total === null
        ? `${p.answered} answered`
        : `${p.answered} of ${p.total} answered`,
    p === null ? `started ${fmtDay(s.date)}` : fmtAgo(p.last_activity),
    "not scored until you finish",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/session/${s.session_id}`}
      className="rv mb-9 grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 border border-ember/35 bg-[linear-gradient(90deg,var(--color-ember-soft),var(--keylight-fade)_46%)] px-6 py-5 transition-colors hover:border-ember sm:grid-cols-[auto_1fr_auto]"
      data-io
    >
      <span className="inline-flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.18em] whitespace-nowrap text-ember uppercase">
        <span className="size-[7px] flex-none bg-ember animate-pulse-rec" aria-hidden="true" />
        Unfinished
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[1.04rem] font-bold tracking-[-0.01em] uppercase">
          {sessionTitle(s)}
        </span>
        <span className="mt-1.5 block font-mono text-[0.63rem] tracking-[0.1em] text-ink-muted uppercase">
          {detail}
        </span>
      </span>
      <span className={cx(BTN_SM, "col-span-2 sm:col-span-1")}>
        Pick it back up <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

function DrillStrip({ cardsDue, streakDays }: { cardsDue: number; streakDays: number }) {
  if (cardsDue === 0 && streakDays === 0) return null;

  const detail = [
    cardsDue > 0 ? `${cardsDue} question${cardsDue === 1 ? "" : "s"} due` : "nothing due right now",
    streakDays > 0 ? `${streakDays}-day streak` : null,
    "about a minute each",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rv mb-9" data-io>
      <Link
        href="/drill"
        className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 border border-line px-6 py-5 transition-colors hover:border-ember sm:grid-cols-[auto_1fr_auto]"
      >
        <span className="font-mono text-[0.6rem] tracking-[0.18em] whitespace-nowrap text-ink-muted uppercase">
          Daily drill
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[1.04rem] font-bold tracking-[-0.01em] uppercase">
            {cardsDue > 0 ? "The questions that caught you out" : "Deck clear"}
          </span>
          <span className="mt-1.5 block font-mono text-[0.63rem] tracking-[0.1em] text-ink-muted uppercase">
            {detail}
          </span>
        </span>
        <span className={cx(TAG, "border-line text-ink-soft", "col-span-2 sm:col-span-1")}>
          Open the deck →
        </span>
      </Link>
      <Explain className="mt-3">
        Answers you scored badly on, and questions you starred, come back here on a spaced schedule
        — a day later, then three, then a week, for as long as you keep getting them right. The
        streak counts calendar days you drilled, in your own timezone.{" "}
        <b>It is a habit counter, not a score.</b>
      </Explain>
    </div>
  );
}

const KPI_CELL =
  "border-t border-line px-6 py-6 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0";
const KPI_KEY = "font-mono text-[0.6rem] tracking-[0.2em] text-ink-muted uppercase";
const KPI_VAL =
  "tabular mt-2.5 flex items-baseline gap-1 font-display text-[2.9rem] leading-none font-extrabold [&_small]:font-mono [&_small]:text-[0.32em] [&_small]:font-medium [&_small]:tracking-[0.08em] [&_small]:text-ink-muted";
const KPI_NOTE = "mt-2 text-[0.85rem] leading-snug text-ink-soft";
const KPI_DELTA = "font-mono text-[0.78rem]";

function Kpis({ stats }: { stats: DashboardStats }) {
  const { last_score: last, first_score: first, completed } = stats;
  const climb = last !== null && first !== null && completed > 1 ? last - first : null;
  const fillers = stats.fillers_per_answer;
  const fillersFirst = stats.fillers_per_answer_first;
  const fillerDelta =
    fillers !== null && fillersFirst !== null && completed > 1
      ? Math.round((fillers - fillersFirst) * 10) / 10
      : null;

  return (
    <section
      className="rv grid border border-line sm:grid-cols-[1.3fr_1fr_1fr]"
      data-io
      aria-label="Your numbers"
    >
      <div className={KPI_CELL}>
        <p className={KPI_KEY}>Latest verdict</p>
        <p className={cx(KPI_VAL, "sm:text-[3.4rem]")}>
          {last === null ? "—" : last}
          {last === null ? null : <small>/100</small>}
        </p>
        {climb === null ? (
          completed === 1 ? (
            <p className={KPI_NOTE}>Your first session — this is the baseline.</p>
          ) : null
        ) : (
          <p className={KPI_NOTE}>
            {climb === 0 ? (
              "Level with your first session."
            ) : (
              <>
                <span className={cx(KPI_DELTA, climb > 0 ? "text-strong" : "text-weak")}>
                  {climb > 0 ? "▲ up" : "▼ down"} {Math.abs(climb)} points
                </span>{" "}
                since your first session.
              </>
            )}
          </p>
        )}
        {last === null ? null : <ScoreBand score={last} />}
        <Explain>
          The bands are what the number buys you. <b>Hire-able</b> means most interviewers pass you
          to the next round but don&rsquo;t fight for you; <b>strong</b> is where they start
          fighting.
          {last === null ? null : ` You're in "${BAND_LABEL[scoreBand(last)].toLowerCase()}".`}
        </Explain>
      </div>

      <div className={KPI_CELL}>
        <p className={KPI_KEY}>Sessions run</p>
        <p className={KPI_VAL}>{completed}</p>
        <p className={KPI_NOTE}>
          {stats.sessions_this_week > 0 ? (
            <>
              <span className={cx(KPI_DELTA, "text-strong")}>+{stats.sessions_this_week}</span> in
              the last 7 days.
            </>
          ) : (
            "None in the last 7 days."
          )}
        </p>
        <Explain>
          Just a count of interviews that made it all the way to a report. More isn&rsquo;t
          automatically better — rerunning the <b>same</b> brief is what moves the score.
        </Explain>
      </div>

      <div className={KPI_CELL}>
        <p className={KPI_KEY}>Filler words</p>
        <p className={KPI_VAL}>
          {fillers === null ? "—" : fillers}
          <small>per answer</small>
        </p>
        {fillerDelta === null || fillerDelta === 0 ? null : (
          <p className={KPI_NOTE}>
            <span className={cx(KPI_DELTA, fillerDelta < 0 ? "text-strong" : "text-weak")}>
              {fillerDelta < 0 ? "▼" : "▲"} {fillerDelta < 0 ? "down" : "up"} from {fillersFirst}
            </span>{" "}
            in your first session.
          </p>
        )}
        <Explain>
          &ldquo;Um&rdquo;, &ldquo;uh&rdquo;, &ldquo;like&rdquo;, &ldquo;you know&rdquo; — counted
          from the words of your answers, typed or spoken, and divided by the answers you gave. A
          handful is normal speech; a pile of them is what people mean when they say someone sounded
          nervous.
        </Explain>
      </div>
    </section>
  );
}

const STATUS_TAG: Record<SessionStatus, { label: string; className: string }> = {
  in_progress: { label: "Unfinished", className: "border-ember/45 text-ember" },
  generating_report: { label: "Scoring now", className: "border-ember/45 text-ember" },
  completed: { label: "Report ready", className: "border-strong/40 text-strong" },
  cancelled: { label: "Cancelled", className: "border-line text-ink-muted" },
  abandoned: { label: "Abandoned", className: "border-line text-ink-muted" },
  error: { label: "Report failed", className: "border-weak/40 text-weak" },
};

const STATUS_TILE: Record<SessionStatus, { label: string; className: string }> = {
  in_progress: { label: "Live", className: "border-ember/40 text-ember" },
  generating_report: { label: "Building", className: "border-ember/40 text-ember" },
  completed: { label: "—", className: "border-line text-ink-muted" },
  cancelled: { label: "Ended", className: "border-line text-ink-muted" },
  abandoned: { label: "Ended", className: "border-line text-ink-muted" },
  error: { label: "Failed", className: "border-weak/40 text-weak" },
};

const TILE = "grid size-14 flex-none place-items-center border bg-paper leading-none";

function SessionRow({ session: s }: { session: RecentSession }) {
  const href =
    s.status === "in_progress"
      ? `/session/${s.session_id}`
      : s.status === "completed" || s.status === "generating_report" || s.status === "error"
        ? `/report/${s.session_id}`
        : null;

  const tag = STATUS_TAG[s.status];
  const tile = STATUS_TILE[s.status];
  const verdict = s.status === "completed" && s.score !== null ? s.score : null;

  const body = (
    <>
      {verdict !== null ? (
        <span
          className={cx(
            TILE,
            "font-display text-[1.4rem] font-extrabold",
            TILE_TONE[scoreTone(verdict)],
          )}
        >
          {verdict}
        </span>
      ) : (
        <span
          className={cx(TILE, "font-mono text-[0.6rem] tracking-[0.1em] uppercase", tile.className)}
        >
          {tile.label}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-display text-[1.02rem] leading-tight font-bold uppercase">
          {sessionTitle(s)}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[0.62rem] tracking-[0.1em] text-ink-muted uppercase">
          <span>{fmtDay(s.date)}</span>
          {s.name?.trim() && s.role?.trim() ? (
            <>
              <span className="text-ink-faintest" aria-hidden="true">
                /
              </span>
              <span className="truncate">{s.role}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className={cx(TAG, tag.className, "max-sm:hidden")}>{tag.label}</span>
      {href ? (
        <span
          className="grid size-9 flex-none place-items-center border border-line font-mono text-[0.8rem] text-ink-soft transition-colors group-hover:border-ember group-hover:bg-ember group-hover:text-paper"
          aria-hidden="true"
        >
          →
        </span>
      ) : null}
    </>
  );

  const shell =
    "group grid grid-cols-[auto_1fr_auto] items-center gap-5 border-b border-line px-6 py-5 transition-colors last:border-b-0 hover:bg-(--surface-hover) sm:grid-cols-[auto_1fr_auto_auto]";

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  behavioral: "Cultural",
};

function StarredPreview({
  starred,
}: {
  starred: Awaited<ReturnType<typeof repo.listStarredQuestions>>;
}) {
  return (
    <section className="rv" data-io>
      <SecHead
        meta={`${starred.length} saved${starred.length > STARRED_PREVIEW ? ` · ${STARRED_PREVIEW} shown` : ""}`}
      >
        Questions you saved
      </SecHead>

      <Explain className="mb-4">
        You star a question during a report when it caught you out. This list is your homework — the
        questions worth having an answer ready for before the real thing.
      </Explain>

      <ol className="border border-line">
        {starred.slice(0, STARRED_PREVIEW).map((s) => (
          <li
            key={s.id}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-x-5 border-b border-line px-6 py-4 last:border-b-0 sm:grid-cols-[auto_1fr_auto_auto]"
          >
            <span className="text-ember" aria-hidden="true">
              ★
            </span>
            <span className="min-w-0">
              <span className="block text-[0.97rem] text-ink">{s.question}</span>
              {s.turn ? null : (
                <span className="mt-1 block font-mono text-[0.58rem] tracking-[0.1em] text-ink-muted uppercase">
                  Interview deleted — the question is still yours
                </span>
              )}
            </span>
            <span className="font-mono text-[0.6rem] tracking-[0.12em] whitespace-nowrap text-ink-muted uppercase max-sm:hidden">
              {TYPE_LABEL[s.questionType]}
            </span>
            {s.turn ? (
              <Link
                href={`/report/${s.turn.sessionId}`}
                className={cx(
                  TAG,
                  "border-line text-ink-soft transition-colors hover:border-ember hover:bg-ember hover:text-paper",
                )}
              >
                Open report
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <Link
        href="/starred"
        className="mt-4 inline-block font-mono text-[0.62rem] tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ember"
      >
        All saved questions →
      </Link>
    </section>
  );
}
