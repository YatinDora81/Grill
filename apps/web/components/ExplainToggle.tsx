"use client";

import { useEffect, useState } from "react";
import { EXPLAIN_CLASS, EXPLAIN_EVENT, EXPLAIN_KEY } from "./explainMode";

export function ExplainToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(document.body.classList.contains(EXPLAIN_CLASS));
    sync();
    window.addEventListener(EXPLAIN_EVENT, sync);
    return () => window.removeEventListener(EXPLAIN_EVENT, sync);
  }, []);

  const toggle = () => {
    const next = !document.body.classList.contains(EXPLAIN_CLASS);
    document.body.classList.toggle(EXPLAIN_CLASS, next);
    try {
      localStorage.setItem(EXPLAIN_KEY, next ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(EXPLAIN_EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`flex items-center gap-2.5 border border-line px-3 py-2.5 text-left font-mono text-[0.6rem] tracking-[0.14em] text-ink-muted uppercase transition-colors hover:border-line-strong hover:text-ink explain:border-ember/45 explain:text-ink ${className ?? ""}`}
    >
      <span
        className="relative h-3.5 w-6.5 flex-none border border-line-strong explain:border-ember"
        aria-hidden="true"
      >
        <span className="absolute top-0.5 left-0.5 size-2 bg-ink-muted transition-transform explain:translate-x-3 explain:bg-ember" />
      </span>
      Explain mode
    </button>
  );
}
