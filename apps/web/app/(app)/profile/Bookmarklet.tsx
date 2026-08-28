"use client";
import { useEffect, useRef, useState } from "react";

const PAGE_TEXT_MAX = 60_000;

export function bookmarkletHref(origin: string): string {
  const target = `${origin.replace(/\/+$/, "")}/new?mode=jd`;
  const source = `(()=>{try{var d={u:location.href,t:document.title,x:(document.body?document.body.innerText:"").slice(0,${PAGE_TEXT_MAX})};window.open(${JSON.stringify(target)}+"#import="+encodeURIComponent(JSON.stringify(d)),"_blank","noopener")}catch(e){alert("Grill couldn't read this page.")}})()`;
  return `javascript:${encodeURIComponent(source)}`;
}

export interface BookmarkletProps {
  siteUrl?: string;
  compact?: boolean;
}

export function Bookmarklet({ siteUrl, compact = false }: BookmarkletProps) {
  const [origin, setOrigin] = useState(siteUrl ?? "");
  const linkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!siteUrl) setOrigin(window.location.origin);
  }, [siteUrl]);

  useEffect(() => {
    const el = linkRef.current;
    if (!el || !origin) return;
    el.setAttribute("href", bookmarkletHref(origin));
  }, [origin]);

  const link = (
    <a
      ref={linkRef}
      className="inline-flex cursor-grab items-center border border-line-strong bg-paper-raised px-3.5 py-2 font-mono text-[0.7rem] tracking-[0.14em] whitespace-nowrap text-ember uppercase transition-colors hover:border-ember/50"
      draggable
      onClick={(e) => e.preventDefault()}
      title="Drag me to your bookmarks bar"
    >
      Grill this job
    </a>
  );

  if (compact) {
    return (
      <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.8rem] leading-relaxed text-ink-soft">
        {link}
        <span>— drag it to your bookmarks bar, open the posting, then click it.</span>
      </p>
    );
  }

  return (
    <section className="card" aria-labelledby="bookmarklet-head">
      <h2
        id="bookmarklet-head"
        className="font-mono text-[11px] tracking-[0.18em] uppercase text-ink-muted"
      >
        Grill this job
      </h2>
      <p className="mt-3 max-w-[52ch] text-[0.86rem] leading-relaxed text-ink-soft">
        Some job boards — LinkedIn most of all — won&rsquo;t show a posting to anything but a
        logged-in browser. Drag this to your bookmarks bar. Then, on any posting, click it: your
        browser reads the page and hands it straight to a new interview.
      </p>

      <p className="mt-4">{link}</p>

      <p className="mono-note mt-4 max-w-[52ch]">
        the posting travels in the link&rsquo;s fragment, which browsers never send to a server —
        it reaches the form, not our logs
      </p>
    </section>
  );
}
