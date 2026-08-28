import type { Metadata } from "next";
import { getUserId } from "@/lib/auth";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/siteMeta";
import { Landing } from "./Landing";

export const metadata: Metadata = {
  title: { absolute: SITE_TAGLINE },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default async function LandingPage() {
  const signedIn = Boolean(await getUserId());

  return <Landing signedIn={signedIn} />;
}
