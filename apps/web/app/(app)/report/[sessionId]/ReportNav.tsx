"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

/**
 * Sticky section nav for the report.
 *
 * The report is long by design — verdict, fixes, delivery, evidence, then every
 * question. Without a nav the only way to find "what should I actually do" is to
 * scroll and hope. This gives the page a table of contents that also tells you
 * where you currently are.
 *
 * IntersectionObserver rather than a scroll-and-measure loop: a handler that
 * re-measures every section on every frame is real jank on a long report. The
 * observer only wakes when a boundary is actually crossed.
 *
 * `rootMargin` pulls the trigger line down to just under the sticky nav, so a
 * section is marked current when it reaches the nav rather than when it touches
 * the very top of the viewport.
 *
 * The one scroll listener left reads three numbers and measures no sections. It
 * exists because the LAST section can be too short to ever reach that trigger
 * line: at max scroll it sits below the line with the section above it still
 * straddling it, so no boundary is crossed, the observer never fires again, and
 * the nav stays lit on the previous section while the reader looks at this one.
 * At the bottom of the document the last section is by definition the one in
 * view, which is the only thing this listener says.
 */

export interface Section {
  id: string;
  label: string;
}

/**
 * How much chrome sits above the content, right now, in this viewport.
 *
 * This nav is not the only sticky thing on the page: below `lg` the shell's own
 * header is above it and owns the top ~106px, and at `lg` and up that header is
 * `lg:hidden` and the rail is fixed to the left instead. Measuring the header
 * rather than reading a constant means one expression covers both breakpoints —
 * `display: none` makes `offsetHeight` 0, which is exactly the answer we want on
 * desktop.
 *
 * Everything that needs "the line just under the chrome" derives it from here:
 * the scroll target of a nav click, the observer's trigger line, and the fallback
 * for a section too tall to intersect. They used to carry separate hardcoded
 * numbers calibrated against the deleted AppTopbar.
 */
function chromeTop(nav: HTMLElement | null): number {
  const header = document.querySelector<HTMLElement>("[data-app-header]");
  return (header?.offsetHeight ?? 0) + (nav?.offsetHeight ?? 44);
}

function atBottom(): boolean {
  return (
    window.scrollY > 0 &&
    Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2
  );
}

const LINK_BASE =
  "shrink-0 border-b-2 py-3 font-mono text-[0.63rem] tracking-[0.14em] whitespace-nowrap uppercase transition-colors";

/**
 * The scrollbar is hidden, not absent: below `sm` five sections overflow and
 * this strip scrolls, but a painted scrollbar under a 44px chrome bar splits it
 * into two rules of different colours. The overflow itself stays — swiping the
 * nav still works, and `.nav-target` keeps the jump honest either way.
 */
const NAV_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function ReportNav({ sections }: { sections: Section[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const navRef = useRef<HTMLElement>(null);

  /**
   * Re-measured on resize because crossing `lg` swaps ~106px of header for none.
   * `rootMargin` is frozen when the observer is constructed, so the number has to
   * be state that re-runs the effect below rather than something read inside it.
   */
  const [chrome, setChrome] = useState(0);
  useEffect(() => {
    const measure = () => setChrome(chromeTop(navRef.current));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(s.id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    /**
     * Track every section's visibility rather than trusting the newest entry.
     * Scrolling fast can deliver several entries in one callback, and taking the
     * last one makes the highlight jump around. Instead we keep a live map and
     * pick the topmost section that is currently intersecting.
     */
    const visible = new Map<string, boolean>();
    const last = sections[sections.length - 1];
    let bottom = false;

    const resolve = () => {
      if (bottom && last) {
        setCurrent(last.id);
        return;
      }
      const firstVisible = sections.find((s) => visible.get(s.id));
      if (firstVisible) {
        setCurrent(firstVisible.id);
        return;
      }
      /**
       * Nothing intersecting means we're inside one tall section whose top and
       * bottom are both off-screen. Fall back to the last section that has
       * scrolled past the trigger line.
       */
      const passed = nodes.filter((n) => n.getBoundingClientRect().top < chrome).pop();
      if (passed) setCurrent(passed.id);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        resolve();
      },
      { rootMargin: `-${chrome}px 0px -70% 0px`, threshold: 0 },
    );

    const onScroll = () => {
      const now = atBottom();
      if (now === bottom) return;
      bottom = now;
      resolve();
    };

    nodes.forEach((n) => io.observe(n));
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections, chrome]);

  /**
   * Scrolls rather than letting the browser follow the anchor, and deliberately
   * never writes `location.hash`: the replay listens for `#turn-N` hash changes
   * to unfold a turn, and a nav that rewrites the hash on every click fights it.
   */
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    // Measured at click time, not read from state: this is the one place where
    // being a frame stale would put the heading you asked for behind the header.
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - chromeTop(navRef.current) - 24,
      // Respect the user's motion preference rather than the CSS default.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    // Move focus so keyboard users land where the click sent everyone else.
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Report sections"
      /* Sticks UNDER the shell's header rather than on top of it. Both are
         sticky, and matching z-index wouldn't have saved this one: `.wrap` is
         `position: relative; z-index: 2`, so this nav's z-30 is trapped inside a
         stacking context that competes at 2, while the header's is a root-level
         z-20. Below `lg` the nav was painted over completely.

         The veil is a token rather than `bg-paper/90` because blur preserves
         luminance: it smears what is behind it rather than removing it, so on a
         pale page the report's own headings ghost through 90% of the stock as
         legible shape instead of as texture. `--veil-nav` runs it at 95% there.
         Still derived from `--color-paper`, so it stays the page's own colour. */
      className={cx(
        "sticky top-(--app-header-h) z-30 flex gap-6 overflow-x-auto border-b border-line bg-(--veil-nav) backdrop-blur-md sm:gap-10",
        NAV_SCROLLBAR,
      )}
    >
      {sections.map((s) => {
        const on = current === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={on ? "true" : undefined}
            onClick={(e) => jump(e, s.id)}
            className={cx(
              LINK_BASE,
              on
                ? "border-ember text-ink"
                : "border-transparent text-ink-muted hover:text-ink-soft",
            )}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
