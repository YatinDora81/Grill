"use client";

import { useEffect } from "react";

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
