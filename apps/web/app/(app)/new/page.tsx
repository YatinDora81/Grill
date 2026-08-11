import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { ExplainBanner } from "@/components/Explain";
import { NewInterviewForm } from "./NewInterviewForm";

export const metadata: Metadata = {
  title: "New interview",
  description: "Set the brief — role, difficulty and source — and start a mock interview.",
};

const HASH = /^[0-9a-f]{64}$/;
const MAX_DRILL = 12;

function drillHashes(raw: string | string[] | undefined): string[] {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return [];
  return [...new Set(first.split(",").filter((h) => HASH.test(h)))].slice(0, MAX_DRILL);
}

export default async function NewInterviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const starredHashes = mode === "starred" ? drillHashes(params.h) : [];

  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap pb-16">
        <div className="page-head">
          <div>
            <p className="kicker">02 — New session</p>
            {/* "Steps", not "questions": the count this screen actually sets is
                the question count, and it defaults to 8.

                No accent word. The headline used to lift "then you're in" into an
                ember italic; the redesign has no italic anywhere, and on this
                page the only red above the fold is the kicker — a second red in
                the same block would leave neither of them meaning anything.

                The break is hard rather than a short measure: a `ch` cap is
                measured against the digit width and this line is all caps, so it
                lands on two lines at one viewport and three at the next. */}
            <h1 className="h1 mt-4">
              Three steps,
              <br />
              then you&rsquo;re in.
            </h1>
            {/* Not the reference's "you can change all of it later" — in this
                product you can't. A session's config is fixed the moment it
                starts, and the steps are the last place to change any of it. */}
            <p className="page-sub max-w-[54ch]">
              What it should read, how hard it should push, and what to call this. Takes about a
              minute.
            </p>
          </div>
        </div>

        {/* The wrapper carries the same `explain:` gate as the banner: a plain
            spacer div would leave its margin behind on every non-explain view. */}
        <div className="hidden pt-8 explain:block">
          <ExplainBanner />
        </div>

        <NewInterviewForm initialStarredHashes={starredHashes} />
      </main>
    </>
  );
}
