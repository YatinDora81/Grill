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

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your recent interviews, scores and where the trend is going.",
};
// Scores change as sessions finish; never serve a cached dashboard.
export const dynamic = "force-dynamic";

/** How many saved questions the preview shows before deferring to /starred. */
const STARRED_PREVIEW = 3;

/*
 * The house controls, as class strings rather than components — every one of
 * them is used two or three times on this page and nowhere else.
 *
 * The primary button is BONE, not ember. There is one loud red thing per screen
 * and on the dashboard it is the unfinished session's left edge; a red button in
 * the header would compete with it, and the light fill reads as the brightest
 * thing on a near-black page anyway. Heat is what it turns into on hover.
 */
const BTN =
  "inline-flex min-h-[52px] items-center justify-center gap-3 border border-ink bg-ink px-8 font-mono text-[0.8rem] font-semibold tracking-[0.14em] text-paper uppercase transition-colors hover:border-ember hover:bg-ember";
const BTN_SM =
  "inline-flex min-h-10 items-center justify-center gap-2 border border-ink bg-ink px-4 font-mono text-[0.7rem] font-semibold tracking-[0.14em] text-paper uppercase transition-colors";
/** Mono chip. Colour always comes from the caller, never from here — two
 *  `border-*` utilities on one element leave the winner to stylesheet order. */
const TAG =
  "border px-2 py-1 font-mono text-[0.58rem] tracking-[0.14em] whitespace-nowrap uppercase";

export default async function DashboardPage() {
  // proxy.ts already gates this, but a Server Component must never assume that —
  // it reads the DB, so it re-checks rather than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/dashboard");

  const [{ stats, recent }, starred] = await Promise.all([
    getDashboardData(userId),
    repo.listStarredQuestions(userId),
  ]);

  // An unfinished interview is the one thing on this page with a deadline
  // attached, so it gets its own bar. It sits UNDER the readout rather than
  // above it: the readout is the answer to the question the headline asks, and
  // burying that under a resume prompt makes the page open on a chore.
  const resumable = recent.find((s) => s.status === "in_progress") ?? null;
  const scored = stats.completed > 0;
  // The resumable session is featured above; repeating it in the list directly
  // underneath just reads as a duplicate.
  const rest = recent.filter((s) => s.session_id !== resumable?.session_id);

  return (
    <>
      <Reveal threshold={0.12} />

      <main className="wrap pb-14">
        {/* No key-light behind this page. The reference dashboard is flat and
            unlit — the ember glow belongs to the hot seat and the report hero,
            where there is a single thing to light. */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-8 border-b border-line pt-10 pb-7">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] text-ember uppercase">
              01 — Dashboard
            </p>
            {/* The break is hard-coded, not left to a max-width. At this weight
                and this leading the two lines are a single block of type, and a
                measure that happens to break "actually / getting better" one
                viewport width and "are you / actually getting better" the next
                loses that. It still fits one phone line at the clamp's floor. */}
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

        {/* Bare, not wrapped: it's `display: none` when the mode is off, so a
            spacing wrapper here would leave a hole on every other page view. */}
        <ExplainBanner />

        {/* The resume bar already says the one thing that matters, and the
            zero-session readout would be telling a candidate mid-interview that
            they haven't sat one. */}
        {scored || !resumable ? (
          <Readout
            topPattern={stats.top_pattern}
            latestScore={stats.last_score}
            firstScore={stats.first_score}
            sessionCount={stats.completed}
          />
        ) : null}

        {resumable ? <ResumeBar session={resumable} /> : null}

        {scored ? (
          <>
            <Kpis stats={stats} />

            {stats.trend.length > 1 && (
              <section className="rv mt-7 border border-line" data-io>
                <div className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-3.5 font-mono text-[0.62rem] tracking-[0.2em] text-ink-muted uppercase">
                  <b className="font-medium text-ink">Verdict, session by session</b>
                  {/* "tap" rather than "hover" on purpose: the touch user is
                      the one who can't discover this, and a mouse user reads
                      "tap" as "click" and hovers anyway. */}
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

/**
 * The rule the whole page hangs its sections off: a display-weight title, the
 * count on the right in mono, a hairline under both. Repeated rather than
 * abstracted into globals.css because only this page uses it.
 */
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

/** Verdict colour for the square score tile. Border and text move together so
 *  the tile reads as one object rather than a coloured number in a grey box. */
const TILE_TONE = {
  strong: "border-strong/45 text-strong",
  mixed: "border-mixed/45 text-mixed",
  weak: "border-weak/45 text-weak",
} as const;

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

const MINUTE_MS = 60_000;
const HOUR_MS = 36e5;
const DAY_MS = 864e5;

/**
 * How long ago, in words. A calendar date is the right register for a finished
 * interview and the wrong one for a session someone walked out of an hour ago.
 */
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
 * The unfinished interview, pulled out of the list.
 *
 * The whole bar is the link, not just the button on the end — this is the one
 * row on the page where every part of it means "carry on", and a 900px strip
 * with a 140px hit target in the corner is a worse target than the strip.
 */
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
      /* `--keylight-fade` rather than `transparent` as the terminator, and it is
         not pedantry: `transparent` is alpha-zero BLACK, invisible fading out
         of a black page and a grey-brown cast dragged through the middle of the
         same fade over cream. The token is `transparent` on dark. */
      className="rv mb-9 grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 border border-ember/35 bg-[linear-gradient(90deg,var(--color-ember-soft),var(--keylight-fade)_46%)] px-6 py-5 transition-colors hover:border-ember sm:grid-cols-[auto_1fr_auto]"
      data-io
    >
      <span className="inline-flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.18em] whitespace-nowrap text-ember uppercase">
        {/* Square, not a dot. The only circles left in the product are the ones
            where a circle is genuinely the thing — this is a marker, not a
            status light. `animate-pulse-rec` already sits out reduced motion. */}
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
      {/* A span, not a nested link — the bar is already the anchor. */}
      <span className={cx(BTN_SM, "col-span-2 sm:col-span-1")}>
        Pick it back up <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

/**
 * Three numbers, not four.
 *
 * Average and best were two more ways of saying "how you're doing" next to a
 * chart that already says it. What's left is the verdict you'd quote, how much
 * work is behind it, and the one delivery habit the reports actually count.
 *
 * The verdict cell is given the widest track and the largest numeral because it
 * carries the score band underneath it; the other two are footnotes to it.
 */
const KPI_CELL =
  "border-t border-line px-6 py-6 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0";
const KPI_KEY = "font-mono text-[0.6rem] tracking-[0.2em] text-ink-muted uppercase";
const KPI_VAL =
  "tabular mt-2.5 flex items-baseline gap-1 font-display text-[2.9rem] leading-none font-extrabold [&_small]:font-mono [&_small]:text-[0.32em] [&_small]:font-medium [&_small]:tracking-[0.08em] [&_small]:text-ink-muted";
const KPI_NOTE = "mt-2 text-[0.85rem] leading-snug text-ink-soft";
/** The delta is mono so it reads as a measurement, and coloured by direction —
 *  it is the only thing in the cell that says which way you are moving. */
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
        {/* Bone, not verdict colour: the band strip two lines below already
            says which side of the bar this number falls, and colouring the
            numeral as well made the cell shout twice. */}
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
        {/* An em dash where the number would be: the report either counted
            fillers for that session or it didn't, and guessing is worse. */}
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
        {/* No recording claim and no threshold: the count comes off the
            transcript text, which a typed answer has too, and the product holds
            no per-answer figure to quote. Same wording as the report screen. */}
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

/**
 * The right-hand chip says what the session IS; the tile on the left says how it
 * went. Splitting them is why a row can show a green 72 next to "report ready"
 * without either one being redundant.
 */
const STATUS_TAG: Record<SessionStatus, { label: string; className: string }> = {
  in_progress: { label: "Unfinished", className: "border-ember/45 text-ember" },
  generating_report: { label: "Scoring now", className: "border-ember/45 text-ember" },
  completed: { label: "Report ready", className: "border-strong/40 text-strong" },
  cancelled: { label: "Cancelled", className: "border-line text-ink-muted" },
  abandoned: { label: "Abandoned", className: "border-line text-ink-muted" },
  error: { label: "Report failed", className: "border-weak/40 text-weak" },
};

/** What the tile says when there is no score to put in it. Never a number — an
 *  unfinished session has no verdict and must not look like it scored zero. */
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

  const tag = STATUS_TAG[s.status];
  const tile = STATUS_TILE[s.status];
  // A score only counts once the report exists. Anything else shows a word, so
  // an unfinished session can never be mistaken for one that scored zero.
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
          {/* Only when the session carries a name of its own — otherwise the
              role IS the title, and this would print it twice. */}
          {s.name?.trim() && s.role?.trim() ? (
            <>
              {/* Ink, not a rule. `text-line-strong` is a DIVIDER token, and a
                  divider is specified against the surface it splits — on the
                  sheet that lands this glyph at 2.56:1 while the two strings it
                  separates sit near 5. A separator between metadata is type. */}
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

  // Three tracks on a phone, four from `sm`. Declaring four everywhere left a
  // 20px gutter hanging off the right of every row once the chip went
  // `max-sm:hidden` — an empty track is still a track the gap applies to.
  //
  // The hover fill is `--surface-hover` rather than `bg-paper-raised`: a row
  // under the pointer has to take ON ink on the sheet, where a static raised
  // card still lifts off it. Same value on dark, opposite sign on light.
  const shell =
    "group grid grid-cols-[auto_1fr_auto] items-center gap-5 border-b border-line px-6 py-5 transition-colors last:border-b-0 hover:bg-(--surface-hover) sm:grid-cols-[auto_1fr_auto_auto]";

  // Cancelled and abandoned sessions have nothing to open — a row that looks
  // like a link and does nothing is worse than one that plainly doesn't.
  //
  // No `aria-label`: it would replace the row's own text as the accessible
  // name, so a screen reader would hear the title and lose the date, the score
  // and the status — everything the row is actually for.
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
  // Legacy turns: `behavioral` and `cultural` always meant the same thing.
  behavioral: "Cultural",
};

/**
 * The questions you kept, three at a time.
 *
 * Homework, not a headline — so no filled button. Only the chip on the right is
 * a link, rather than the whole row: the row's job is to let you read the
 * question, and a full-width target invites a click from someone who was only
 * re-reading it.
 */
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
              {/* Null once the interview it came from is deleted. The star is
                  the point; the link back is a bonus, so its absence is quiet —
                  and a control that looks live and goes nowhere is worse. */}
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
