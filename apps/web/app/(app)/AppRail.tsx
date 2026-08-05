"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExplainToggle } from "@/components/ExplainToggle";
import { LogoutButton } from "./LogoutButton";
import { STEP_BUILDING, STEP_EVENT } from "./appStep";

/**
 * Persistent numbered navigation for the signed-in shell.
 *
 * The problem it solves: the app is five screens that happen in an order, and
 * the old topbar showed three of them with no hint that the other two existed or
 * that any of it was a sequence. Numbering says "you go 02 → 03 → 04 → 05 in one
 * sitting" without a word of instruction.
 *
 * Three of those five are not addressable. The hot seat and the build screen
 * only exist inside a session, and the report lives at /report/[sessionId] with
 * no static index. Rather than invent hrefs that 404, they render as inert
 * markers — dimmed, not clickable, present only to show the shape of the trip.
 * `05 Report` still lights up when you are actually on one.
 *
 * The hot seat itself is in the (room) group and deliberately renders no
 * navigation at all: mid-interview the only exits should be Pause and Finish
 * early, and a stray click on "Dashboard" must not be able to end a recording.
 *
 * LAYOUT: the desktop rail is `fixed` and lives OUTSIDE `.app-root`, which
 * reserves space for it with padding. That is not incidental — `.app-root` is a
 * flex COLUMN, and `.foot { margin-top: auto }`, `.report-main { flex: 1 }` and
 * the `.report-main + .foot` gap rule all depend on it staying one. Making the
 * shell a row to seat a rail inside it turns the footer into a third column.
 *
 * The phone/tablet header is a SEPARATE export (`AppHeader`) that the shell
 * renders as its first child, because that rationale does NOT extend to it: a
 * block-level header is just the flex column's first row. It has to live inside
 * for `min-height: 100dvh` to be honest — sitting above the shell it added its
 * own ~106px of flow height on top of a full viewport, which pushed the footer
 * permanently below the fold and gave every signed-in page a scrollbar it had no
 * content for.
 */

interface Item {
  n: string;
  label: string;
  /** Absent for the steps that only exist inside a session. */
  href?: string;
  /** Route prefix that should light this item up even without an href. */
  match?: string;
  hint?: string;
  /**
   * Lit while <body data-step> says the build screen is up, instead of by route.
   * `report` is the inverse: it has to go dark for that stretch, or the two light
   * together at the one address they share.
   */
  step?: "building" | "report";
}

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "Practice",
    items: [
      { n: "01", label: "Dashboard", href: "/dashboard" },
      { n: "02", label: "New session", href: "/new" },
    ],
  },
  {
    heading: "In flight",
    items: [
      { n: "03", label: "Hot seat", hint: "Starts when you begin a session" },
      { n: "04", label: "Building", step: "building", hint: "While your report is being written" },
    ],
  },
  {
    heading: "Results",
    items: [
      {
        n: "05",
        label: "Report",
        match: "/report",
        step: "report",
        hint: "Opens from a finished session",
      },
      { n: "★", label: "Saved questions", href: "/starred" },
    ],
  },
];

const ITEM =
  "grid grid-cols-[26px_minmax(0,1fr)] items-center gap-2 border-l-2 px-5 py-3 font-mono text-[0.73rem] tracking-[0.1em] uppercase transition-colors";
const NUM = "text-[0.66rem] not-italic";

/**
 * The square initial tile in the rail foot and the mobile header.
 *
 * Not the shared `.avatar` class: that one is ember-bordered on an ember-soft
 * fill, which in the rail put a second red mark two rows under the active item's
 * red edge and made the foot compete with the navigation. Here the only red in
 * the rail should be the thing that says where you are.
 */
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

  /**
   * Prefix match, not equality: /report/abc123 must still light up "Report", and
   * a future /starred/tag would still light up "Saved questions". The trailing
   * slash guard stops /new matching a sibling like /newsletter.
   */
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  /**
   * Whether the build screen is currently up. Starts false and is corrected on
   * mount for the same reason the explain toggle is: the server cannot know, and
   * rendering from the DOM would be a hydration mismatch.
   */
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    const sync = () => setBuilding(document.body.dataset.step === STEP_BUILDING);
    sync();
    window.addEventListener(STEP_EVENT, sync);
    return () => window.removeEventListener(STEP_EVENT, sync);
  }, []);

  const activeFor = (item: Item) => {
    // The two steps that share /report/[sessionId] are decided by the marker, not
    // the path — one is lit exactly when the other is not.
    if (item.step === "building") return building;
    const path = item.href ?? item.match;
    if (!path) return false;
    return isActive(path) && !(item.step === "report" && building);
  };

  return (
    <>
      {/* ── desktop: the rail ─────────────────────────────────────────────── */}
      <nav
        aria-label="Sections"
        /* Sunken, not paper: the rail is the wall the page hangs on. Lighter than
           the content it would read as a floating panel, which is the one thing a
           permanent chrome column must never look like. */
        className="fixed inset-y-0 left-0 z-30 hidden w-(--rail-w) flex-col border-r border-line bg-paper-sunken lg:flex"
      >
        <Link
          href="/"
          aria-label="Grill home"
          className="wordmark flex h-[62px] flex-none items-center border-b border-line px-5 uppercase"
          /* Inline, not `text-*`/`tracking-*`: `.wordmark` is unlayered CSS, so it
             outranks every Tailwind utility no matter what is written here. The
             rail wants the mark at label scale, and uppercase display needs
             positive tracking to stop the caps closing up. */
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
                const active = activeFor(item);
                if (!item.href) {
                  return (
                    <div
                      key={item.label}
                      title={item.hint}
                      aria-current={active ? "step" : undefined}
                      className={`${ITEM} cursor-default ${
                        active
                          ? "border-l-ember bg-paper-raised text-ink"
                          : "border-l-transparent text-ink-muted/45"
                      }`}
                    >
                      <em className={`${NUM} ${active ? "text-ember" : "text-ink-muted/40"}`}>
                        {item.n}
                      </em>
                      <span className="truncate">{item.label}</span>
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`${ITEM} ${
                      active
                        ? "border-l-ember bg-paper-raised text-ink"
                        : "border-l-transparent text-ink-muted hover:bg-paper-raised hover:text-ink"
                    }`}
                  >
                    <em className={`${NUM} ${active ? "text-ember" : "text-ink-muted/70"}`}>
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
          <LogoutButton className="mt-3.5 block" />
        </div>
      </nav>
    </>
  );
}

/**
 * Phone and tablet: the same destinations, as chrome.
 *
 * The rail is hidden below `lg` rather than reflowed, so this carries the only
 * route to /starred and /profile at those widths. Hiding it without a
 * replacement would strand both.
 *
 * Rendered INSIDE `.app-root` (see the layout note on `AppRail`), and separate
 * from the rail for that reason alone — everything it navigates is shared state
 * from this same file.
 *
 * `data-app-header` is a hook, not a style: ReportNav measures this element to
 * work out how far below the fold to place a section it jumps to. Measuring beats
 * a shared constant there because `lg:hidden` already makes `offsetHeight` 0 on
 * desktop, so one expression covers both breakpoints. `--app-header-h` in
 * globals.css exists for the same height where only CSS can reach it.
 *
 * z-20, deliberately below ReportNav's z-30: they are both sticky and this one is
 * physically above, so the nav has to be able to slide under it rather than the
 * other way round.
 */
export function AppHeader({ initials }: { initials: string }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return (
    <header
      data-app-header
      className="sticky top-0 z-20 border-b border-line bg-paper-sunken/90 backdrop-blur-md lg:hidden"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <Link
          href="/"
          className="wordmark uppercase"
          aria-label="Grill home"
          /* Same reason as the rail: `.wordmark` is unlayered and cannot be
             resized by a utility. Bigger than the rail's mark because here it is
             the only thing in the row that carries the brand. */
          style={{ fontSize: 17, letterSpacing: "0.06em" }}
        >
          grill<i>.</i>
        </Link>
        <div className="flex items-center gap-2">
          {/* No width class: the toggle carries none of its own, so it hugs its
              label here and fills the rail there without either side fighting
              the cascade. */}
          <ExplainToggle />
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
        {GROUPS.flatMap((g) => g.items)
          .filter((i) => i.href)
          .map((item) => {
            const active = isActive(item.href!);
            return (
              <Link
                key={item.href}
                href={item.href!}
                aria-current={active ? "page" : undefined}
                /* Square, and the active mark is a bottom edge rather than the
                   rail's left one — the row runs horizontally here, so the edge
                   has to sit on the axis the eye scans across. */
                className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2 font-mono text-[0.66rem] tracking-[0.1em] whitespace-nowrap uppercase transition-colors ${
                  active
                    ? "border-b-ember bg-paper-raised text-ink"
                    : "border-b-transparent text-ink-muted hover:text-ink"
                }`}
              >
                <em className={`${NUM} ${active ? "text-ember" : "text-ink-muted/70"}`}>
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
