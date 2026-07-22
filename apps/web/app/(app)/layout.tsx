import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { LogoutButton } from "./LogoutButton";

/**
 * Every route in this group is signed-in, per-candidate data. Restated here
 * rather than left to the root default so that flipping the root to
 * index-by-default later can't silently expose reports and transcripts.
 *
 * `nocache` on top of noindex: it also tells Google and Bing to drop any cached
 * copy, which plain noindex does not.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

const NAV_LINK =
  "relative text-sm text-ink-muted transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:text-ink";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* No fill: a raised bar reads as a brown band across the top. The room's
          chrome is the page colour plus a hairline, as in the reference. */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/dashboard">
            <Wordmark className="text-xl" />
          </Link>
          <nav className="flex items-center gap-5">
            {/* Pseudo-element hit area (~68x46) rather than `h-11`: the row's
                height is set by the 36px Sign out button, so a real 44px box
                here would push the header taller on every page, desktop
                included, to solve a touch problem. */}
            <Link href="/starred" className={NAV_LINK}>
              Starred
            </Link>
            <Link href="/profile" className={NAV_LINK}>
              Profile
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
