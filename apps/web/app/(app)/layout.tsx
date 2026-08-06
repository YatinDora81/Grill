import type { Metadata } from "next";
import { AppHeader, AppRail } from "./AppRail";
import { currentUser, initialsOf } from "./currentUser";

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

/**
 * The shell every signed-in page sits in: one warm room, grain over it, a
 * numbered rail down the left. Pages supply their own key-light (the report's
 * comes from the other side of the page than the dashboard's), so it isn't
 * rendered here.
 *
 * `AppRail` — the DESKTOP rail — is a SIBLING of `.app-root`, not a child, and
 * reserves its space with padding rather than a column. `.app-root` is a flex
 * column and three separate rules lean on it staying one —
 * `.foot { margin-top: auto }` pins the footer on short pages,
 * `.report-main { flex: 1 }` eats the free space above it, and
 * `.report-main + .foot` restates the gap that `flex: 1` consumed. Seating the
 * rail inside the shell would make the footer a third column.
 *
 * `AppHeader` — the phone/tablet chrome — goes the other way and is the shell's
 * FIRST CHILD, where the old topbar sat. It's block-level, so it's simply the
 * flex column's first row and none of those three rules notice it. It has to be
 * inside: `.app-root { min-height: 100dvh }` counts only itself, so a header
 * stacked above the shell added its own height to a box that already demanded a
 * full viewport, and the footer ended up a header's height below the fold on
 * every signed-in page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const initials = initialsOf(user?.name ?? null);

  return (
    <>
      <a
        href="#main"
        className="sr-only border border-ember bg-paper font-mono text-[0.66rem] tracking-[0.14em] text-ink uppercase focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <AppRail name={user?.name ?? null} initials={initials} />
      <div className="app-root lg:pl-(--rail-w)">
        <div className="grain" aria-hidden="true" />
        <AppHeader initials={initials} />
        <div id="main" tabIndex={-1} className="sr-only" />
        {children}
        <footer className="foot">
          <div className="wrap foot-in">
            <span className="wordmark" style={{ fontSize: 17 }}>
              grill<i>.</i>
            </span>
            <span className="foot-note">practice under heat</span>
          </div>
        </footer>
      </div>
    </>
  );
}
