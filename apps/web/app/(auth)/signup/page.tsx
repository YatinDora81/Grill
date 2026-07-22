import { Suspense } from "react";
import type { Metadata } from "next";
import { OG_IMAGE } from "@/lib/siteMeta";
import { AuthForm } from "../AuthForm";

const DESCRIPTION =
  "Create a free Grill account and take a mock interview built from your resume, a job description or a repo.";

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

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
