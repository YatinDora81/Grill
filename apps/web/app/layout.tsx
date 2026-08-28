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
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: DARK_PAPER,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${archivo.variable} ${geistMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{if(localStorage.getItem(${JSON.stringify(EXPLAIN_KEY)})==="1")` +
              `document.body.classList.add(${JSON.stringify(EXPLAIN_CLASS)})}catch(e){}`,
          }}
        />
        <KeepAlive />
        {children}
      </body>
    </html>
  );
}
