import type { Metadata } from "next";
import { AppTopbar } from "./AppTopbar";
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
 * The shell every signed-in page sits in: one warm room, grain over it, chrome
 * top and bottom. Pages supply their own key-light (the report's comes from the
 * other side of the page than the dashboard's), so it isn't rendered here.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <div className="app-root">
      <div className="grain" aria-hidden="true" />
      <AppTopbar name={user?.name ?? null} initials={initialsOf(user?.name ?? null)} />
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
  );
}
