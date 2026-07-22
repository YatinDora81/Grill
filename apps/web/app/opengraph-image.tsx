import { ImageResponse } from "next/og";
import {
  OG_IMAGE_ALT,
  OG_IMAGE_SIZE,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/siteMeta";

/**
 * The card Slack, iMessage and X paint when the landing page is linked.
 *
 * Rendered here rather than shipped as a PNG so the copy stays in one place —
 * siteMeta.ts feeds the <title>, the meta description and this image, and a
 * static asset would be the one copy nobody remembers to re-export.
 *
 * Deliberately no webfont: Bricolage would have to be fetched over the network
 * at build time, and a flaky font CDN failing the whole build is a worse trade
 * than a card set in the default sans. Colours are globals.css verbatim.
 */

// Both re-exported from siteMeta so the dimensions a page declares in
// `openGraph.images` can never disagree with the PNG actually rendered here.
export const alt = OG_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

const PAPER = "#16120e";
const INK = "#f3ecde";
const INK_SOFT = "#b6ac99";
const EMBER = "#f2642f";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: PAPER,
          padding: "0 90px",
          // The ember bloom the room uses, flattened to a radial so satori can
          // render it — it has no blur filter.
          backgroundImage: `radial-gradient(circle at 12% 108%, rgba(242,100,47,0.30) 0%, rgba(242,100,47,0) 55%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              backgroundColor: EMBER,
            }}
          />
          <div
            style={{
              fontSize: 40,
              letterSpacing: "-0.02em",
              color: INK,
              fontWeight: 600,
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div
          style={{
            marginTop: 40,
            fontSize: 78,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            color: INK,
            fontWeight: 600,
            maxWidth: 940,
          }}
        >
          Mock interviews that tell you the truth.
        </div>

        <div
          style={{
            marginTop: 32,
            fontSize: 32,
            lineHeight: 1.35,
            color: INK_SOFT,
            maxWidth: 860,
          }}
        >
          {SITE_DESCRIPTION}
        </div>

        <div
          style={{
            marginTop: 56,
            width: 132,
            height: 6,
            borderRadius: 999,
            backgroundColor: EMBER,
          }}
        />
      </div>
    ),
    size,
  );
}
