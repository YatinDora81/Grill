import { Explain } from "@/components/Explain";

/**
 * The first thing on the dashboard: what the numbers below actually add up to,
 * in one sentence.
 *
 * Decision-first layout. Someone opening this screen wants to know "am I getting
 * better, and what's still wrong" — not to assemble that answer themselves from
 * four stat cards and a chart. Everything below this box is the evidence for
 * this box.
 *
 * The empty state matters as much as the filled one. With one or two sessions
 * there is no pattern yet, and saying so plainly is better than inventing an
 * insight from a single data point.
 *
 * No button. There is only ever one primary action on this screen and it belongs
 * to the header, or to the unfinished session below.
 */

/** A red left edge rather than a whole red panel: heat marks the one thing worth
 *  reading first, and a filled surface would stop reading as pressure. */
const SHELL = "rv mb-7 border border-line border-l-[3px] border-l-ember bg-paper-raised px-7 py-6";
const KICKER = "mb-3.5 font-mono text-[0.58rem] tracking-[0.24em] text-ink-muted uppercase";
/*
 * Set several steps larger than body copy and held to 66ch. This is the one
 * paragraph on the page meant to be read rather than scanned, and the measure is
 * what makes it land as a sentence instead of a caption.
 *
 * `b` is ember here, not ink. Everywhere else in the product bold means "the
 * important half of this sentence"; in this box it means "the phrase your next
 * session hangs on", and the reference leans on red to pick those out of a long
 * line of type.
 */
const BODY =
  "max-w-[66ch] text-[1.16rem] leading-[1.62] text-ink [&_b]:font-semibold [&_b]:text-ember";

interface Props {
  /** The recurring weakness across recent answers. `null` until there's enough data. */
  topPattern: string | null;
  latestScore: number | null;
  firstScore: number | null;
  /** Scored sessions — reports on the record, not interviews started. */
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
          {/* Also the wording when there ARE three sessions but the answers
              behind them carry no usable rubric — "one or two sessions" would
              be a lie in that case, and this reads true in both. */}
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
