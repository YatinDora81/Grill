import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { BAND_LABEL, cx, scoreBand, scoreTone } from "@/components/ui";
import { Explain, ExplainBanner } from "@/components/Explain";
import { Reveal } from "@/components/Reveal";
import { initialsOf } from "../currentUser";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your account details, your record, and your password.",
};
// The record strip reads live scores; never serve a cached copy of it.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;

/** Score → verdict class, or nothing at all when there is no score to colour. */
function tone(v: number | null): string {
  return v === null ? "" : TONE_CLASS[scoreTone(v)];
}

export default async function ProfilePage() {
  // proxy.ts gates this, but a Server Component reading the DB re-checks rather
  // than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/profile");

  // The plate, the record and the star count in one round trip each — same
  // shape as the dashboard's fetch, scoped to this user throughout.
  const [user, reports, starred] = await Promise.all([
    repo.getUserById(userId),
    repo.listUserReports(userId),
    repo.listStarredQuestions(userId),
  ]);
  if (!user) redirect("/dashboard");

  const scores: number[] = reports.map((r: { overallScore: number }) => r.overallScore);
  const completed = scores.length;
  const avg = completed ? Math.round(scores.reduce((a, b) => a + b, 0) / completed) : null;
  const best = completed ? Math.max(...scores) : null;

  const since = `${MONTHS[user.createdAt.getUTCMonth()]} ${user.createdAt.getUTCFullYear()}`;

  return (
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            {/* Screen slug, same shape as every other header in the redesign.
                No leading number: the numbered set is the interview flow
                (01 dashboard → 05 report) and this page sits outside it. */}
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
              Your file
            </p>
            {/* Set at a short measure so it breaks over two or three lines —
                the headline is the loudest thing on the page and a one-word
                one ("Your file.") could not carry that job. */}
            <h1 className="h1 mt-3.5 max-w-[15ch]">
              Who the interviewer thinks it&apos;s grilling
            </h1>
            <p className="page-sub max-w-[52ch]">
              Your account, your record, and the password on it.
            </p>
          </div>
          <Link href="/new" className="btn btn-secondary">
            New interview
          </Link>
        </div>

        {/* Bare, not wrapped: it's `display: none` when the mode is off, so a
            spacing wrapper here would leave a hole on every other page view. */}
        <ExplainBanner />

        {/* The plate: who you are to the product, and since when.
            Plain `.card`, no `.card-hairline`: that modifier paints a 2px ember
            gradient across the top of the card, and the redesign spends its one
            gradient on the resume bar. A hairline border is the whole edge now. */}
        <section className="card id-plate rv" data-io aria-label="Your account">
          <span className="seal" aria-hidden="true">
            {initialsOf(user.name)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="id-name">{user.name?.trim() || "Unnamed candidate"}</h2>
            <p className="id-mail">{user.email}</p>
            <p className="id-since">
              <span className="live-dot" aria-hidden="true" />
              On the grill since <i>{since}</i>
            </p>
          </div>
        </section>

        {/* The record. Same ledger the dashboard runs — a profile that hides
            your numbers is flattering, and flattery is the other tools' job. */}
        <div className="mt-10 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
            Your record
          </h2>
          <p className="trend-note">
            {completed ? `${completed} scored · all time` : "nothing scored yet"}
          </p>
        </div>

        {/* Inline margin, not a utility: `.stats` sets `margin-top: 34px` in
            unlayered CSS, which outranks any Tailwind class no matter the
            order. The strip now has a header to sit under, so it closes up. */}
        <section className="stats rv" style={{ marginTop: 12 }} data-io aria-label="Your record">
          <Stat label="Interviews" value={completed} unit={false}>
            Interviews that reached a report. Started-and-abandoned ones aren&rsquo;t counted here —
            nothing you didn&rsquo;t finish is held against you.
          </Stat>
          <Stat label="Average" value={avg}>
            Every scored session, weighted the same. It moves slowly on purpose:{" "}
            <b>one good day shouldn&rsquo;t erase the pattern</b>, and one bad day shouldn&rsquo;t
            either.
          </Stat>
          <Stat label="Best" value={best}>
            Your ceiling — proof of what you can do on a good day.
            {best === null
              ? null
              : ` At ${best} that's "${BAND_LABEL[scoreBand(best)].toLowerCase()}" territory.`}{" "}
            The job is making it your average.
          </Stat>
          {/* The cell stays a plain `.stat` so it keeps its divider and the
              `:nth-child` rules the mobile grid depends on; the link shrinks to
              wrap only the label and the number. The note has to sit OUTSIDE it:
              in explain mode a `<p>` inside the anchor joins the link's
              accessible name, so a screen reader would announce the whole
              paragraph as the destination. */}
          <div className="stat">
            <Link href="/starred" className="stat-link -mx-2 block px-2 py-1">
              <p className="stat-k">Starred</p>
              <p className="stat-v">
                {starred.length}
                <span className="stat-go" aria-hidden="true">
                  ↗
                </span>
              </p>
            </Link>
            <Explain>
              Questions you kept during a report because they caught you out. Not a score —{" "}
              <b>a to-do list</b>.
            </Explain>
          </div>
        </section>

        <ProfileForm user={toUserDTO(user)} />

        <p className="fineprint rv" data-io>
          Every session, recording and report is scoped to <b>this account</b> — nobody else can
          reach them. Session recordings auto-delete after 100 days.
        </p>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  unit = true,
  children,
}: {
  label: string;
  value: number | null;
  /** Interview count has no denominator — it's a tally, not a score. */
  unit?: boolean;
  /** The plain-English note shown under the figure in explain mode. */
  children?: React.ReactNode;
}) {
  return (
    <div className="stat">
      <p className="stat-k">{label}</p>
      <p className={cx("stat-v", unit ? tone(value) : "")}>
        {value === null ? "—" : value}
        {unit && value !== null ? <small>/100</small> : null}
      </p>
      {children ? <Explain>{children}</Explain> : null}
    </div>
  );
}
