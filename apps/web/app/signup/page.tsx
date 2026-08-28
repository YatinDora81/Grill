import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OG_IMAGE } from "@/lib/siteMeta";

const DESCRIPTION =
  "Create a free Grill account and take a mock interview built from your resume, a job description or a repo.";

export const metadata: Metadata = {
  title: "Sign up",
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/signup" },
  openGraph: {
    url: "/signup",
    title: "Sign up for Grill",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=signup&next=${encodeURIComponent(next)}` : "/?auth=signup");
}
