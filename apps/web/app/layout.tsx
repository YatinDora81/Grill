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
import {
  DARK_PAPER,
  DEFAULT_PREF,
  LIGHT_PAPER,
  LIGHT_QUERY,
  THEME_ATTR,
  THEME_KEY,
  THEME_PREF_ATTR,
} from "@/components/theme";
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
  // `viewportFit: cover` was meant to remove one. Imported rather than retyped
  // so that check has one place to happen.
  //
  // Still the DARK hex now that a light theme exists, and deliberately not the
  // media-scoped array form. `viewport` is a build-time export evaluated with no
  // request, no cookies and no localStorage, so it cannot see the reader's
  // preference; the array form would answer to the OS instead, which is the
  // wrong authority when the app's own default is dark regardless of it. This is
  // the no-JS answer, and the pre-paint script below reconciles the tag to
  // LIGHT_PAPER whenever the preference resolves light.
  themeColor: DARK_PAPER,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // `color-scheme: dark` used to be an inline style here. It now lives in
      // `:root { color-scheme: dark }` in globals.css, because an inline style
      // sits at the top of the cascade where no stylesheet rule can reach it:
      // the UA would have gone on painting scrollbar gutters, <select> popups,
      // spellcheck underlines, `:-webkit-autofill` fills and the overscroll area
      // dark on light — black holes punched through a cream page. The bare
      // `:root` rule reproduces this exactly, including for a reader with
      // JavaScript off who never receives an attribute at all.
      //
      // The script below writes `data-theme` and `data-theme-pref` up here,
      // which the server cannot know. The `suppressHydrationWarning` on <body>
      // does not cover it: that flag is one element deep and does not inherit
      // upward, so the two guard different mutations and both are needed.
      suppressHydrationWarning
      className={`${geist.variable} ${archivo.variable} ${geistMono.variable}`}
    >
      <head>
        {/* The theme, restored before first paint — and in <head> rather than at
            the top of <body> where the explain script sits. That one can wait
            because it writes `document.body.classList` and needs <body> to
            exist; this one has to beat the first pixel, and Next streams the RSC
            payload, so body content can be parsed and painted before a script
            placed after <body> ever runs. `document.documentElement` exists as
            soon as the parser sees <html>.

            The flash this prevents runs the opposite way to the usual one: dark
            is the CSS default and the server always renders dark, so a
            dark-preferring reader can never flash at all. The reader at risk is
            the one who chose light, and one frame of the black room is the more
            startling direction, not the less. */}
        <script
          dangerouslySetInnerHTML={{
            // Interpolated from the shared constants rather than typed out, for
            // the same reason the explain script is: renaming any one of them
            // can't leave this hand-minified string quietly reading a key
            // nothing writes.
            //
            // Both attributes are written even for dark, never only for light,
            // so any future `[data-theme]`-keyed rule can be authored in both
            // directions. `try{}catch(e){}` because private mode throws on
            // `localStorage` and `matchMedia` is absent in some embedded UAs;
            // either way it falls through to dark, which is what the stylesheet
            // already paints. And the `theme-color` reconcile is
            // order-independent on purpose: if Next's tag was emitted first we
            // mutate it, and if ours lands first it wins the first-match lookup.
            __html:
              `try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
              `var t=p==="light"?"light":p==="system"&&window.matchMedia&&matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark";` +
              `var d=document.documentElement;d.setAttribute(${JSON.stringify(THEME_ATTR)},t);` +
              `d.setAttribute(${JSON.stringify(THEME_PREF_ATTR)},p||${JSON.stringify(DEFAULT_PREF)});` +
              `var m=document.querySelector('meta[name="theme-color"]');` +
              `if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}` +
              `m.setAttribute("content",t==="light"?${JSON.stringify(LIGHT_PAPER)}:${JSON.stringify(DARK_PAPER)})}catch(e){}`,
          }}
        />
      </head>
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
