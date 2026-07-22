import type { Metadata } from "next";
import { getUserId } from "@/lib/auth";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/siteMeta";
import { Landing } from "./Landing";

export const metadata: Metadata = {
  // `absolute` so the root template doesn't render "Grill — … · Grill".
  title: { absolute: SITE_TAGLINE },
  description: SITE_DESCRIPTION,
  // The one page that opts out of the root's noindex default.
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/**
 * Stays a Server Component so the cookie decides what renders, not a flash of
 * the wrong nav. Everything below the fold — the modal, the reveal choreography,
 * the ?auth= deep link — lives in <Landing>, which is the client half.
 */
export default async function LandingPage() {
  // Signed-in visitors get "Dashboard" instead of "Sign up" — being sold to
  // after you've already bought is a small insult. It's also what keeps the auth
  // modal from ever mounting for them.
  const signedIn = Boolean(await getUserId());

  return <Landing signedIn={signedIn} />;
}
