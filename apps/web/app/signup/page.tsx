import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OG_IMAGE } from "@/lib/siteMeta";

const DESCRIPTION =
  "Create a free Grill account and take a mock interview built from your resume, a job description or a repo.";

/**
 * Carried over from the page this route replaced: /signup was the indexable SEO
 * entry point, and a shared link that previews as nothing is a link nobody clicks.
 */
export const metadata: Metadata = {
  title: "Sign up",
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/signup" },
  // Restated rather than inherited: a shared /signup link that previews as the
  // landing page's title is a link people think they already clicked.
  openGraph: {
    url: "/signup",
    title: "Sign up for Grill",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/** Same as /login: the form moved into the landing page's modal, ?next= and all. */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=signup&next=${encodeURIComponent(next)}` : "/?auth=signup");
}
