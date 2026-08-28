import { Explain } from "@/components/Explain";

const SHELL = "rv mb-7 border border-line border-l-[3px] border-l-ember bg-paper-raised px-7 py-6";
const KICKER = "mb-3.5 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase";
const BODY =
  "max-w-[66ch] text-[1.16rem] leading-[1.62] text-ink [&_b]:font-semibold [&_b]:text-ember";

interface Props {
  topPattern: string | null;
  latestScore: number | null;
  firstScore: number | null;
  sessionCount: number;
}

export function Readout({ topPattern, latestScore, firstScore, sessionCount }: Props) {
  if (sessionCount === 0) {
    return (
      <section className={SHELL} data-io>
        <p className={KICKER}>Start here</p>
        <p className={BODY}>
          You haven&rsquo;t sat a session yet. Paste a real job description and answer out loud —
          the first report takes about fifteen minutes to earn and tells you more than any amount of
          reading about interviews.
        </p>
      </section>
    );
  }

  if (topPattern === null) {
    return (
      <section className={SHELL} data-io>
        <p className={KICKER}>The short version</p>
        <p className={BODY}>
          {latestScore !== null ? (
            <>
              Your last session scored <b>{latestScore} out of 100</b>.{" "}
            </>
          ) : null}
          There aren&rsquo;t enough scored answers yet to call a pattern — run a couple more
          sessions and this box will name the single habit costing you the most.
        </p>
        <Explain>
          Patterns need repetition. A weakness that shows up once might be the question; a weakness
          that shows up in four sessions is <b>you</b>, and that&rsquo;s the one worth drilling.
        </Explain>
      </section>
    );
  }

  const climbed = latestScore !== null && firstScore !== null && latestScore > firstScore;

  return (
    <section className={SHELL} data-io>
      <p className={KICKER}>The short version</p>
      <p className={BODY}>
        {climbed ? (
          <>
            Across {sessionCount} sessions your verdict climbed from {firstScore} to{" "}
            <b>{latestScore} out of 100</b>.{" "}
          </>
        ) : latestScore !== null ? (
          <>
            Your latest verdict is <b>{latestScore} out of 100</b> across {sessionCount}{" "}
            sessions.{" "}
          </>
        ) : null}
        <b>{topPattern}</b>
      </p>
      <Explain>
        This box is Grill reading the per-answer scores from your recent sessions and naming the
        dimension you average lowest on. Nothing here is new data — it&rsquo;s the summary of
        everything below.
      </Explain>
    </section>
  );
}
