import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { KeepAlive } from "@/components/KeepAlive";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Grill — mock interviews that tell you the truth",
    template: "%s · Grill",
  },
  description:
    "AI mock interviews that ask real follow-ups and score how you actually sound. Composure under heat.",
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
  themeColor: "#0a0a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // `color-scheme: dark` so scrollbars, autofill and native controls come up
      // dark too — without it they punch light holes in the room.
      style={{ colorScheme: "dark" }}
      className={`${geist.variable} ${bricolage.variable} ${geistMono.variable}`}
    >
      <body>
        {/* Root layout, so every page pings — including the room, where a cold
            start between answers would land on the report build. */}
        <KeepAlive />
        {children}
      </body>
    </html>
  );
}
