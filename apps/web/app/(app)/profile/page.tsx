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
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;

function tone(v: number | null): string {
  return v === null ? "" : TONE_CLASS[scoreTone(v)];
}

export default async function ProfilePage() {
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/profile");

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
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
              Your file
            </p>
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

        <ExplainBanner />

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

        <div className="mt-10 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
            Your record
          </h2>
          <p className="trend-note">
            {completed ? `${completed} scored · all time` : "nothing scored yet"}
          </p>
        </div>

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

        <ProfileForm user={toUserDTO(user)} emailOnReport={user.emailOnReport} />

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
  unit?: boolean;
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
