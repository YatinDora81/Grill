"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

export interface Section {
  id: string;
  label: string;
}

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

const NAV_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function ReportNav({ sections }: { sections: Section[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const navRef = useRef<HTMLElement>(null);

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

  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - chromeTop(navRef.current) - 24,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  };

  return (
    <nav
      ref={navRef}
      aria-label="Report sections"
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
