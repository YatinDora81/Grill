"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DrillQueueResponse } from "@repo/types";
import { apiGet } from "@/lib/apiClient";
import { ExplainToggle } from "@/components/ExplainToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "./LogoutButton";

interface Item {
  n: string;
  label: string;
  href: string;
}

const DRILL = "/drill";

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "Practice",
    items: [
      { n: "01", label: "Dashboard", href: "/dashboard" },
      { n: "02", label: "New session", href: "/new" },
      { n: "03", label: "Question bank", href: "/questions" },
      { n: "04", label: "Drill", href: DRILL },
    ],
  },
  {
    heading: "Results",
    items: [{ n: "\u2605", label: "Saved questions", href: "/starred" }],
  },
];

let dueCards: number | null = null;
let dueRequest: Promise<number> | null = null;
let dueEpoch = 0;

function forgetDueCards() {
  dueCards = null;
  dueRequest = null;
  dueEpoch += 1;
}

function loadDueCards(): Promise<number> {
  if (dueCards !== null) return Promise.resolve(dueCards);
  const epoch = dueEpoch;
  dueRequest ??= apiGet<DrillQueueResponse>("/api/drill?limit=1")
    .then((queue) => queue.due_total)
    .catch(() => 0)
    .then((count) => {
      if (epoch !== dueEpoch) return dueCards ?? count;
      dueCards = count;
      dueRequest = null;
      return count;
    });
  return dueRequest;
}

function useDueCards(): number {
  const pathname = usePathname();
  const [due, setDue] = useState(dueCards ?? 0);
  const wasDrilling = useRef(false);

  useEffect(() => {
    let alive = true;
    const drilling = pathname === DRILL || pathname.startsWith(`${DRILL}/`);
    if (wasDrilling.current && !drilling) forgetDueCards();
    wasDrilling.current = drilling;

    void loadDueCards().then((count) => {
      if (alive) setDue(count);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);

  return due;
}

function ItemLabel({ item, due }: { item: Item; due: number }) {
  const badge = item.href === DRILL && due > 0;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{item.label}</span>
      {badge ? (
        <em className="tabular flex-none border border-ember/40 px-1.5 py-0.5 text-[0.6rem] leading-none not-italic text-ember">
          {due > 99 ? "99+" : due}
          <span className="sr-only"> due</span>
        </em>
      ) : null}
    </span>
  );
}

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
  const due = useDueCards();

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
                  <ItemLabel item={item} due={due} />
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
  const due = useDueCards();
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
                <ItemLabel item={item} due={due} />
              </Link>
            );
          })}
      </nav>
    </header>
  );
}
