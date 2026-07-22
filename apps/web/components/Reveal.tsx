"use client";

import { useEffect } from "react";

/**
 * Reveal-on-scroll for server-rendered pages.
 *
 * Renders nothing. Anything marked `data-io` and classed `.rv` starts faded and
 * gets `.io-in` when it first crosses into view; it's unobserved straight after,
 * because this is choreography, not state — re-animating on the way back up is
 * nausea, not delight. `prefers-reduced-motion` pins `.rv` visible in CSS, so
 * this becomes a no-op rather than something to feature-detect here.
 */
export function Reveal({ threshold = 0.12 }: { threshold?: number }) {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("io-in");
            io.unobserve(e.target);
          }
        }),
      { threshold },
    );
    document.querySelectorAll("[data-io]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [threshold]);

  return null;
}
