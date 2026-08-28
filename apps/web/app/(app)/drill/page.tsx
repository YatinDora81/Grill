import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { config } from "@/lib/env";
import { getUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { getDrillQueue } from "@/lib/services/drillService";
import { Explain, ExplainBanner } from "@/components/Explain";
import { Reveal } from "@/components/Reveal";
import { DrillDeck } from "./DrillDeck";

export const metadata: Metadata = {
  title: "Drill",
  description: "The questions that caught you out, asked again on a schedule.",
};
export const dynamic = "force-dynamic";

const DRILL_MAX_SECONDS = 75;

export default async function DrillPage() {
  const userId = await getUserId();
  if (!userId) redirect("/?auth=login&next=/drill");

  const [queue, user] = await Promise.all([getDrillQueue(userId), repo.getUserById(userId)]);

  return (
    <>
      <Reveal threshold={0.12} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
              Daily drill
            </p>
            <h1 className="h1 mt-3.5 max-w-[14ch]">The questions that caught you out</h1>
            <p className="page-sub max-w-[52ch]">
              {queue.due_total > 0 ? (
                <>
                  <b>
                    {queue.due_total} question{queue.due_total === 1 ? "" : "s"}
                  </b>{" "}
                  due. One at a time, about a minute each.
                </>
              ) : (
                "Nothing due right now. A few cards early is still practice."
              )}
            </p>
          </div>
          <Link href="/new" className="btn btn-secondary">
            New interview
          </Link>
        </div>

        <ExplainBanner />

        <Explain>
          A card comes back on a spacing schedule: answer it well and it disappears for weeks, blank
          it and it is back tomorrow. That is the point —{" "}
          <b>you only re-see what you haven&rsquo;t learned yet</b>, so the deck shrinks as you get
          better rather than growing as you practise.
        </Explain>

        <div className="rv" data-io>
          <DrillDeck
            initial={queue}
            needsTimezone={!user?.timezone}
            maxSeconds={Math.min(DRILL_MAX_SECONDS, config.audio.maxSeconds)}
            maxBytes={config.audio.maxBytes}
          />
        </div>
      </main>
    </>
  );
}
