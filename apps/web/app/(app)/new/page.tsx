import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { ExplainBanner } from "@/components/Explain";
import { exclusiveModeSchema } from "@/lib/schemas";
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
  const raw = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const asked = exclusiveModeSchema.safeParse(raw);
  const mode = asked.success ? asked.data : null;
  const starredHashes = mode === "starred" ? drillHashes(params.h) : [];
  const initialMode = mode === "starred" ? null : mode;

  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap pb-16">
        <div className="page-head">
          <div>
            <p className="kicker">02 — New session</p>
            <h1 className="h1 mt-4">
              Three steps,
              <br />
              then you&rsquo;re in.
            </h1>
            <p className="page-sub max-w-[54ch]">
              What it should read, how hard it should push, and what to call this. Takes about a
              minute.
            </p>
          </div>
        </div>

        <div className="hidden pt-8 explain:block">
          <ExplainBanner />
        </div>

        <NewInterviewForm initialStarredHashes={starredHashes} initialMode={initialMode} />
      </main>
    </>
  );
}
