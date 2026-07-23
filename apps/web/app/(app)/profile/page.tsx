import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { cx, scoreTone } from "@/components/ui";
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
            <h1 className="h1">
              Your <i>file.</i>
            </h1>
            <p className="page-sub">Who the interviewer thinks it&apos;s grilling.</p>
          </div>
          <Link href="/new" className="btn btn-secondary">
            New interview
          </Link>
        </div>

        {/* The plate: who you are to the product, and since when. */}
        <section className="card card-hairline id-plate rv" data-io aria-label="Your account">
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
        <section className="stats rv" data-io aria-label="Your record">
          <Stat label="Interviews" value={completed} unit={false} />
          <Stat label="Average" value={avg} />
          <Stat label="Best" value={best} />
          <Link href="/starred" className="stat stat-link">
            <p className="stat-k">Starred</p>
            <p className="stat-v">
              {starred.length}
              <span className="stat-go" aria-hidden="true">
                ↗
              </span>
            </p>
          </Link>
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
}: {
  label: string;
  value: number | null;
  /** Interview count has no denominator — it's a tally, not a score. */
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
