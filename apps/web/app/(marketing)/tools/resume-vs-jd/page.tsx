import type { Metadata } from "next";
import Link from "next/link";
import { getUserId } from "@/lib/auth";
import { OG_IMAGE } from "@/lib/siteMeta";
import { ExplainBanner } from "@/components/Explain";
import { GapForm } from "./GapForm";

const DESCRIPTION =
  "Paste a job description, drop your résumé, and see which requirements you can actually evidence — and which ones are gaps an interviewer will find first. Free, no account, nothing saved.";

export const metadata: Metadata = {
  title: "Résumé vs job description — the gap checker",
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/tools/resume-vs-jd" },
  keywords: [
    "resume vs job description",
    "resume gap analysis",
    "job description match",
    "resume keyword match",
    "am I qualified for this job",
    "interview preparation",
  ],
  openGraph: {
    url: "/tools/resume-vs-jd",
    title: "Résumé vs JD — the gaps, before they find them",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const STEPS = [
  {
    n: "01",
    t: "Give it both documents",
    d: "The posting, and your résumé as a PDF, DOCX or plain text. Neither one leaves this request.",
  },
  {
    n: "02",
    t: "It looks for evidence, not keywords",
    d: "A requirement only counts as covered when a line of your résumé proves it. Anything it can't point at is a gap.",
  },
  {
    n: "03",
    t: "Then you get grilled on the gaps",
    d: "Carry the posting into a real mock interview and answer the questions the gaps invite. That part needs an account.",
  },
];

export default async function ResumeVsJdPage() {
  const signedIn = Boolean(await getUserId());

  return (
    <div className="app-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap pb-16">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-dashed border-(--stroke-dashed) bg-paper-raised px-4 py-3.5 sm:mt-8">
          <p className="font-mono text-[0.66rem] leading-relaxed tracking-[0.13em] uppercase text-ink-muted">
            <span className="text-ember">Free tool.</span> No account, no upload history —{" "}
            <span className="text-ink">nothing is saved unless you sign up.</span>
          </p>
          <Link href="/" className="underlink">
            back to grill
          </Link>
        </div>

        <header className="page-head">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase text-ember">
              Tools — résumé vs JD
            </p>
            <h1 className="h1 mt-3">
              The gaps, before <i>they</i> find them
            </h1>
            <p className="page-sub max-w-[62ch]">
              Paste the posting, drop your résumé, and read which requirements you can actually{" "}
              <b>evidence</b> — and which ones you would have to talk your way through. Same parser
              the interview uses. One pass, no account, nothing stored.
            </p>
          </div>
        </header>

        <div className="mt-9">
          <ExplainBanner />
          <GapForm signedIn={signedIn} />
        </div>

        <section className="mt-[clamp(44px,7vh,64px)]" aria-label="How this works">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-line pb-2.5">
            <h2 className="font-display text-[1.08rem] font-extrabold tracking-[0.01em] uppercase">
              What actually happens
            </h2>
            <p className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-ink-muted">
              stateless · one request
            </p>
          </div>
          <div className="mt-4 grid border-t border-l border-line md:grid-cols-3">
            {STEPS.map((s) => (
              <div className="border-r border-b border-line p-6" key={s.n}>
                <p className="font-display text-[1.6rem] leading-none font-bold text-ember">
                  {s.n}
                </p>
                <p className="mt-3.5 font-mono text-[0.72rem] leading-normal tracking-[0.1em] uppercase text-ink">
                  {s.t}
                </p>
                <p className="mt-2.5 text-[0.89rem] leading-relaxed text-ink-soft">{s.d}</p>
              </div>
            ))}
          </div>
          <p className="mono-note" style={{ marginTop: 14 }}>
            your résumé and the posting are read once, in memory, to answer this one request — they
            are never written to a database, and nothing is saved unless you sign up
          </p>
        </section>

        <div className="endrow">
          <p className="text-[0.9rem] text-ink-soft">
            Want to see what the interview itself produces?{" "}
            <Link
              href="/sample"
              className="underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ember"
            >
              Read a sample verdict →
            </Link>
          </p>
          <Link href="/" className="underlink">
            back to grill
          </Link>
        </div>
      </main>
    </div>
  );
}
