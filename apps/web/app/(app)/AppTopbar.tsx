"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./LogoutButton";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/starred", label: "Starred" },
  { href: "/profile", label: "Profile" },
] as const;

/**
 * The signed-in room's chrome: wordmark, three places to be, and who you are.
 *
 * A client component only because the active link needs the current path — the
 * alternative is every page passing its own name in, which is the same fact
 * written five times.
 */
export function AppTopbar({ name, initials }: { name: string | null; initials: string }) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <Link href="/dashboard" className="wordmark" aria-label="Grill home">
          grill<i>.</i>
        </Link>
        <nav className="topnav" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-right">
          {/* Sign-out sits with the avatar: the identity and the way to drop it
              belong in the same corner. */}
          <LogoutButton />
          <span className="avatar" title={name ?? "Your account"} aria-hidden="true">
            {initials}
          </span>
        </div>
      </div>
    </header>
  );
}
