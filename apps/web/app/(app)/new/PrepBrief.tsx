"use client";

import { useState } from "react";
import type { CompanyBriefResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, ErrorNote, Spinner, cx } from "@/components/ui";

const EYEBROW = "font-mono text-[10.5px] tracking-[0.16em] uppercase";
const PANEL = "mt-6 border border-line bg-paper-sunken p-5 sm:p-6";

export function briefAge(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

export function PrepBrief({ company, role }: { company: string; role?: string | null }) {
  const [result, setResult] = useState<CompanyBriefResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(refresh: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiPost<CompanyBriefResponse>("/api/company/brief", {
        company,
        ...(role?.trim() ? { role: role.trim() } : {}),
        refresh,
      });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Couldn't reach the researcher. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={PANEL} aria-label={`Prep brief for ${company}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <p className={cx(EYEBROW, "text-ember")}>Prep brief</p>
        <p className={cx(EYEBROW, "text-ink-muted")}>{company}</p>
      </div>

      {result ? null : (
        <>
          <p className="mt-3 text-[0.86rem] leading-relaxed text-ink-soft">
            What they do, what they have been up to lately, how their interviews run, and six
            questions they are likely to ask{role?.trim() ? ` a ${role.trim()}` : ""}.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button type="button" size="sm" onClick={() => void load(false)} disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Reading up on them…" : "Build my prep brief"}
            </Button>
            <p className="mono-note" role="status">
              {busy ? "searching · this takes a moment the first time" : "one lookup · cached"}
            </p>
          </div>
        </>
      )}

      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      {result ? <Brief result={result} busy={busy} onRefresh={() => void load(true)} /> : null}
    </section>
  );
}

function Brief({
  result,
  busy,
  onRefresh,
}: {
  result: CompanyBriefResponse;
  busy: boolean;
  onRefresh: () => void;
}) {
  const { brief } = result;

  return (
    <div className={cx("mt-5", busy && "opacity-60")}>
      {result.grounded ? null : (
        <p className={cx(EYEBROW, "text-mixed")}>From general knowledge — not today&rsquo;s news</p>
      )}

      {brief.what_they_do ? (
        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink">{brief.what_they_do}</p>
      ) : null}

      {brief.recent_news.length > 0 ? (
        <Section title="Lately">
          <ul className="mt-3 grid gap-3.5">
            {brief.recent_news.map((item, i) => (
              <li key={`${item.headline}-${i}`} className="border-l-2 border-line pl-3.5">
                <p className="text-[0.86rem] leading-snug text-ink">{item.headline}</p>
                {item.date ? <p className="mono-note mt-1">{item.date}</p> : null}
                <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-soft">
                  {item.why_it_matters}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.values.length > 0 ? (
        <Section title="What they say they value">
          <ul className="mt-3 flex flex-wrap gap-2">
            {brief.values.map((v, i) => (
              <li key={`${v}-${i}`} className="chip">
                {v}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.interview_style_notes.length > 0 ? (
        <Section title="How they interview">
          <Lines items={brief.interview_style_notes} />
        </Section>
      ) : null}

      {brief.likely_questions.length > 0 ? (
        <Section title="What they are likely to ask">
          <Lines items={brief.likely_questions} numbered />
        </Section>
      ) : null}

      {brief.questions_to_ask.length > 0 ? (
        <Section title="Ask them this">
          <Lines items={brief.questions_to_ask} numbered />
        </Section>
      ) : null}

      {result.sources.length > 0 ? (
        <Section title="Read from">
          <ul className="mt-3 grid gap-1.5">
            {result.sources.map((s) => (
              <li key={s.uri}>
                <a
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underlink text-[0.8rem] break-all"
                >
                  {s.title || s.uri}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5">
        <p className="mono-note">
          researched {briefAge(result.generated_at)}
          {result.cached ? " · from the shared cache" : ""}
        </p>
        <button type="button" onClick={onRefresh} disabled={busy} className="underlink">
          {busy ? "refreshing…" : "refresh"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className={cx(EYEBROW, "border-b border-line pb-2 text-ink-muted")}>{title}</h3>
      {children}
    </div>
  );
}

function Lines({ items, numbered = false }: { items: string[]; numbered?: boolean }) {
  return (
    <ul className="mt-3 grid gap-2.5">
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="flex gap-3 text-[0.86rem] leading-relaxed text-ink-soft">
          <span className="mono-note shrink-0 pt-0.5" aria-hidden>
            {numbered ? String(i + 1).padStart(2, "0") : "—"}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
