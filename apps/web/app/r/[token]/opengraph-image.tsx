import { createHash } from "node:crypto";
import { ImageResponse } from "next/og";
import * as repo from "@/lib/db/repo";
import { config } from "@/lib/env";
import { shareTokenSchema } from "@/lib/schemas";
import { BAND_LABEL, scoreBand, scoreTone } from "@/components/ui";
import { OG_IMAGE_SIZE, SITE_NAME } from "@/lib/siteMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const alt = `${SITE_NAME} — a shared mock-interview verdict: the score out of 100 and the band it lands in.`;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

const PAPER = "#0e0e0e";
const PAPER_RAISED = "#131313";
const INK = "#e9e6df";
const INK_SOFT = "#9b978e";
const LINE_STRONG = "#3a3833";
const EMBER = "#ff4633";
const VERDICT_COLOR = { strong: "#8fbf6b", mixed: "#d9a441", weak: "#e05c4f" } as const;

export default async function SharedVerdictImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await lookup(token);

  const host = hostOf(config.site.url);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: PAPER,
        border: `1px solid ${LINE_STRONG}`,
        padding: "35px 72px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: INK }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.02em" }}>grill</span>
        <span style={{ fontWeight: 700, color: EMBER }}>·</span>
      </div>

      {shared ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 196,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: INK,
              }}
            >
              {shared.score}
            </span>
            <span
              style={{
                fontSize: 62,
                lineHeight: 1,
                fontWeight: 700,
                marginLeft: 12,
                color: INK_SOFT,
              }}
            >
              /100
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
            <span
              style={{
                display: "flex",
                fontSize: 26,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: shared.tone,
                border: `1px solid ${shared.tone}`,
                backgroundColor: PAPER_RAISED,
                padding: "8px 18px",
              }}
            >
              {shared.band}
            </span>
            <span
              style={{
                fontSize: 22,
                marginLeft: 22,
                color: INK_SOFT,
              }}
            >
              {shared.meta}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              width: 160,
              height: 3,
              backgroundColor: EMBER,
              marginTop: 30,
            }}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 88,
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: INK,
              maxWidth: 900,
            }}
          >
            This link is no longer live.
          </span>
          <div
            style={{
              display: "flex",
              width: 160,
              height: 3,
              backgroundColor: EMBER,
              marginTop: 30,
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", fontSize: 22, color: INK_SOFT }}>
        {`the interview before the interview — ${host}`}
      </div>
    </div>,
    size,
  );
}

interface CardData {
  score: number;
  band: string;
  tone: string;
  meta: string;
}

async function lookup(token: string): Promise<CardData | null> {
  try {
    const parsed = shareTokenSchema.safeParse(token);
    if (!parsed.success) return null;
    const shared = await repo.getSharedReport(
      createHash("sha256").update(parsed.data).digest("hex"),
    );
    if (!shared) return null;

    const meta = [
      shared.role?.trim().toLowerCase(),
      `${shared.questionCount} question${shared.questionCount === 1 ? "" : "s"}`,
      shared.createdAt
        .toLocaleDateString("en-GB", { month: "short", year: "numeric" })
        .toLowerCase(),
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      score: shared.overallScore,
      band: BAND_LABEL[scoreBand(shared.overallScore)],
      tone: VERDICT_COLOR[scoreTone(shared.overallScore)],
      meta,
    };
  } catch (err) {
    console.error("[share-og] card lookup failed:", err);
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
