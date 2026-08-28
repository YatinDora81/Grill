import { ImageResponse } from "next/og";
import {
  OG_IMAGE_ALT,
  OG_IMAGE_SIZE,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/siteMeta";

export const alt = OG_IMAGE_ALT;
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

const PAPER = "#0e0e0e";
const INK = "#e9e6df";
const INK_SOFT = "#9b978e";
const EMBER = "#ff4633";

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
          backgroundImage: `radial-gradient(circle at 12% 108%, rgba(255,70,51,0.28) 0%, rgba(255,70,51,0) 55%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 18,
              height: 18,
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
            fontSize: 74,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            textTransform: "uppercase",
            color: INK,
            fontWeight: 800,
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
            backgroundColor: EMBER,
          }}
        />
      </div>
    ),
    size,
  );
}
