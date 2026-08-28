"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExplainToggle } from "@/components/ExplainToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "./LogoutButton";

interface Item {
  n: string;
  label: string;
  href: string;
}

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "Practice",
    items: [
      { n: "01", label: "Dashboard", href: "/dashboard" },
      { n: "02", label: "New session", href: "/new" },
      { n: "03", label: "Question bank", href: "/questions" },
    ],
  },
  {
    heading: "Results",
    items: [{ n: "\u2605", label: "Saved questions", href: "/starred" }],
  },
];

/* The fill below is a TOKEN rather than `bg-paper-raised`: on the sheet a
   selected or hovered row has to take ON ink, while a static raised card still
   lifts off the page. One value cannot do both once the ground flips, so
   `--rail-hover` is the half that reverses and `bg-paper-raised` — the account
   tile, the panels on the pages this rail leads to — is the half that does not.

   `--rail-hover` and not `--surface-hover`, which is the same idea for rows on a
   raised CARD: these sit on the SUNKEN rail, a surface already darker than the
   page, so the two want different values the moment neither ground is black.
   This one can also run darker than that one, because the rail pairs `hover:bg`
   with `hover:text-ink` at every call site below — nothing muted is ever painted
   on it, which is exactly the constraint that holds `--surface-hover` back. */
const ITEM =
  "grid grid-cols-[26px_minmax(0,1fr)] items-center gap-2 border-l-2 px-5 py-3 font-mono text-[0.73rem] tracking-[0.1em] uppercase transition-colors";
const NUM = "text-[0.66rem] not-italic";

function Initials({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] flex-none place-items-center border border-line font-display text-[0.66rem] font-extrabold text-ink"
    >
      {initials}
    </span>
  );
}

export function AppRail({ name, initials }: { name: string | null; initials: string }) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-y-0 left-0 z-30 hidden w-(--rail-w) flex-col border-r border-line bg-paper-sunken lg:flex"
    >
      <Link
        href="/"
        aria-label="Grill home"
        className="wordmark flex h-[62px] flex-none items-center border-b border-line px-5 uppercase"
        style={{ fontSize: 15, letterSpacing: "0.08em" }}
      >
        grill<i>.</i>
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {GROUPS.map((group) => (
          <div key={group.heading}>
            <div className="px-5 pt-6 pb-2 font-mono text-[0.56rem] tracking-[0.24em] uppercase text-ink-muted">
              {group.heading}
            </div>
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${ITEM} ${
                    active
                      ? "border-l-ember bg-(--rail-hover) text-ink"
                      : "border-l-transparent text-ink-muted hover:bg-(--rail-hover) hover:text-ink"
                  }`}
                >
                  <em className={`${NUM} ${active ? "text-ember" : "text-(--color-ink-faint)"}`}>
                    {item.n}
                  </em>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex-none border-t border-line px-5 py-5">
        <Link
          href="/profile"
          aria-current={isActive("/profile") ? "page" : undefined}
          className="mb-3.5 flex items-center gap-2.5 font-mono text-[0.66rem] tracking-[0.1em] uppercase text-ink-soft transition-colors hover:text-ink"
        >
          <Initials initials={initials} />
          <span className="truncate">{name ?? "Your account"}</span>
        </Link>
        <ExplainToggle className="w-full" />
        <ThemeToggle className="mt-3.5 w-full" />
        <LogoutButton className="mt-3.5 block" />
      </div>
    </nav>
  );
}

export function AppHeader({ initials }: { initials: string }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return (
    <header
      data-app-header
      className="sticky top-0 z-20 border-b border-line bg-(--veil-chrome) backdrop-blur-md lg:hidden"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <Link
          href="/"
          className="wordmark uppercase"
          aria-label="Grill home"
          style={{ fontSize: 17, letterSpacing: "0.06em" }}
        >
          grill<i>.</i>
        </Link>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ExplainToggle />
          <ThemeToggle />
          <LogoutButton />
          <Link href="/profile" aria-label="Profile">
            <Initials initials={initials} />
          </Link>
        </div>
      </div>
      <nav
        aria-label="Sections"
        className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {GROUPS.flatMap((g) => g.items).map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2 font-mono text-[0.66rem] tracking-[0.1em] whitespace-nowrap uppercase transition-colors ${
                  active
                    ? "border-b-ember bg-(--rail-hover) text-ink"
                    : "border-b-transparent text-ink-muted hover:text-ink"
                }`}
              >
                <em className={`${NUM} ${active ? "text-ember" : "text-(--color-ink-faint)"}`}>
                  {item.n}
                </em>
                {item.label}
              </Link>
            );
          })}
      </nav>
    </header>
  );
}
