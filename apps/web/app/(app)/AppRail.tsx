"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExplainToggle } from "@/components/ExplainToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "./LogoutButton";

/**
 * Persistent numbered navigation for the signed-in shell.
 *
 * Every row here is a link. The rail used to also carry the three steps that
 * have no address of their own — the hot seat, the build screen and the report —
 * as inert dimmed markers, on the theory that a numbered 01→05 sequence teaches
 * the shape of the trip. In practice they read as broken menu items: `03 Hot
 * seat` could never light at all, since the rail is not rendered inside the
 * (room) group, and none of the three could be clicked. A nav column is where
 * people click, so rows that never respond belong somewhere else or nowhere.
 *
 * The hot seat is in the (room) group and deliberately renders no navigation:
 * mid-interview the only exits should be Pause and Finish early, and a stray
 * click on "Dashboard" must not be able to end a recording.
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
  href: string;
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

/**
 * The square initial tile in the rail foot and the mobile header.
 *
 * Line-bordered on the base surface rather than the ember-bordered, ember-soft
 * treatment the design gives an avatar: that put a second red mark two rows under
 * the active item's red edge and made the foot compete with the navigation. Here
 * the only red in the rail should be the thing that says where you are.
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

  return (
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
      /* `--veil-chrome`, not `bg-paper-sunken/90`: a backdrop blur preserves
         luminance, so it smears the ink under this header into grey rather
         than removing it, and the fill has to come up on the sheet or the page
         reads through as legible shape instead of as texture. The token has to
         hold 90% on dark — the number this class carried — or the header shifts
         in a theme nobody switched. */
      className="sticky top-0 z-20 border-b border-line bg-(--veil-chrome) backdrop-blur-md lg:hidden"
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
        {/* Scrolls rather than wraps, the same way the section row below does.
            Four controls plus the wordmark do not fit a phone — they did not
            quite fit before the theme switcher was added either — and the two
            alternatives are both worse: wrapping would change the header's
            height, which `--app-header-h` states as a constant and the report's
            `scroll-margin-top` is derived from, and clipping would silently eat
            Sign out. `min-w-0` because a flex item will not shrink below its
            content without it, so the row would push the wordmark out instead. */}
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* No width class on either: the toggles carry none of their own, so
              they hug their labels here and fill the rail there without either
              side fighting the cascade. */}
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
                /* Square, and the active mark is a bottom edge rather than the
                   rail's left one — the row runs horizontally here, so the edge
                   has to sit on the axis the eye scans across. */
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
