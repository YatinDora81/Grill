import Link from "next/link";
import { getUserId } from "@/lib/auth";
import { ButtonLink, Wordmark } from "@/components/ui";

export default async function LandingPage() {
  // Signed-in visitors get "Dashboard" instead of "Sign up" — being sold to
  // after you've already bought is a small insult.
  const signedIn = Boolean(await getUserId());

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Wordmark className="text-2xl" />
        </Link>
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink href="/dashboard" variant="secondary" size="sm">
              Dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Start free
              </ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* Hero */}
        <section className="py-20 sm:py-28">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-1 text-xs text-ink-soft">
            <span className="size-1.5 rounded-full bg-ember" />
            Composure under heat
          </p>
          <h1 className="max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            Mock interviews that
            <br />
            tell you the truth.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            Most practice tools nod along. Grill asks the follow-up you were hoping to
            avoid, then scores what you actually said — and how you actually sounded.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={signedIn ? "/new" : "/signup"} size="lg">
              {signedIn ? "Start an interview" : "Take the hot seat"}
            </ButtonLink>
            <ButtonLink
              href={signedIn ? "/dashboard" : "/login"}
              variant="secondary"
              size="lg"
            >
              {signedIn ? "Go to dashboard" : "I have an account"}
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            Paste a job description, a résumé, or a topic. Eight questions, about
            fifteen minutes.
          </p>
        </section>

        {/* How it works */}
        <section className="border-t border-line py-16">
          <h2 className="font-display text-3xl tracking-tight">How it goes</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Set the brief",
                d: "Paste the job description or your résumé. Pick the level and how many questions you want.",
              },
              {
                n: "02",
                t: "Sit in the hot seat",
                d: "Answer out loud or in writing. Each answer shapes the next question — including the follow-ups you'd rather dodge.",
              },
              {
                n: "03",
                t: "Read the honest report",
                d: "Scores grounded in your own words, plus measured delivery: pace, pauses, fillers, pitch, energy.",
              },
            ].map((s) => (
              <li key={s.n}>
                <span className="font-mono text-xs text-ember">{s.n}</span>
                <h3 className="mt-2 text-base font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Delivery — the differentiator */}
        <section className="border-t border-line py-16">
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl tracking-tight">
                It measures delivery.
                <br />
                It doesn&apos;t guess it.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                Tone is never inferred from your transcript. Pace, pauses and fillers come
                from word-level timings; pitch and energy come from the audio itself. If
                the numbers say you rushed, it&apos;s because you rushed.
              </p>
            </div>
            <div className="rounded-card border border-line bg-paper-raised p-6">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Delivery
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                {[
                  ["Pace", "148 wpm"],
                  ["Avg pause", "310 ms"],
                  ["Fillers", "6"],
                  ["Pitch variation", "24.1 Hz"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-muted">{k}</dt>
                    <dd className="tabular font-mono text-lg">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="border-t border-line py-20 text-center">
          <h2 className="font-display text-4xl tracking-tight">
            Find out before they do.
          </h2>
          <div className="mt-7 flex justify-center">
            <ButtonLink href={signedIn ? "/new" : "/signup"} size="lg">
              {signedIn ? "Start an interview" : "Take the hot seat"}
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-ink-muted">
          <Wordmark className="text-base text-ink" />
          <span>Practice under heat.</span>
        </div>
      </footer>
    </div>
  );
}
