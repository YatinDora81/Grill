import type { Metadata, Viewport } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import { config } from "@/lib/env";
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/siteMeta";
import { KeepAlive } from "@/components/KeepAlive";
import { EXPLAIN_CLASS, EXPLAIN_KEY } from "@/components/explainMode";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

/**
 * The display face. Archivo, not Bricolage: the redesign sets every headline in
 * heavy uppercase at a tight measure, and Bricolage's wide, friendly caps fight
 * that — Archivo was drawn for exactly this kind of condensed editorial setting
 * and holds its colour at 800 weight.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves every relative URL below (canonicals, the OG image) against the
  // real origin. Without it Next warns at build time and falls back to
  // localhost, which ships localhost canonicals to production.
  metadataBase: new URL(config.site.url),
  title: {
    default: SITE_TAGLINE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  // Private by default. Everything except the landing page and signup sits
  // behind auth or is a per-candidate URL, so the safe default is "don't index"
  // and the two public pages opt back in — a new route added under (app) is
  // then unindexable by omission rather than by remembering. app/robots.ts
  // blocks the same paths at the crawler, before it ever fetches the HTML.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    // No `url` here on purpose: openGraph merges wholesale into child segments,
    // so a root og:url would make every page claim to be "/" while its own
    // canonical said otherwise. The two public pages set their own.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  // Phone-number autolinking repaints digits in Safari's own blue — in a dark
  // room that reads as a broken link, and scores like "7/10" are not phone
  // numbers.
  formatDetection: { telephone: false, address: false, email: false },
};

// Without this, mobile browsers assume a ~980px desktop canvas and zoom out —
// every layout below reads as a shrunken desktop page, not a phone one.
// No maximumScale/userScalable lock: candidates must be able to pinch-zoom
// question text, and locking it is a WCAG 1.4.4 failure.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The room paints edge-to-edge dark; `cover` lets it fill past the notch
  // instead of leaving letterbox bars, with safe-area insets doing the padding.
  viewportFit: "cover",
  // Must equal --color-paper in globals.css, not merely be dark: mobile browsers
  // paint their chrome with this, and any drift shows as a seam right where
  // `viewportFit: cover` was meant to remove one.
  themeColor: "#0e0e0e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // `color-scheme: dark` so scrollbars, autofill and native controls come up
      // dark too — without it they punch light holes in the room.
      style={{ colorScheme: "dark" }}
      className={`${geist.variable} ${archivo.variable} ${geistMono.variable}`}
    >
      <body suppressHydrationWarning>
        {/* Explain mode is a class on <body>, restored before first paint.
            Deferring it to a React effect would render every plain-English note
            hidden and then pop the whole set in one frame later, which reads as
            a bug on the exact screen whose job is to reduce confusion.
            `suppressHydrationWarning` is on <body> for this: the server cannot
            know the reader's stored preference, so the class legitimately
            differs between the HTML and the first client render. */}
        <script
          dangerouslySetInnerHTML={{
            // Interpolated from the shared constants rather than typed out, so
            // renaming either one can't leave this script quietly reading a key
            // nothing writes.
            __html:
              `try{if(localStorage.getItem(${JSON.stringify(EXPLAIN_KEY)})==="1")` +
              `document.body.classList.add(${JSON.stringify(EXPLAIN_CLASS)})}catch(e){}`,
          }}
        />
        {/* Root layout, so every page pings — including the room, where a cold
            start between answers would land on the report build. */}
        <KeepAlive />
        {children}
      </body>
    </html>
  );
}
