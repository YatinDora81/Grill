import type { Metadata } from "next";
import { AppHeader, AppRail } from "./AppRail";
import { currentUser, initialsOf } from "./currentUser";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

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
