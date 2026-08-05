import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Ask Grill for a link to set a new password.",
  // Inherits the root's noindex, deliberately: this is a form for people who
  // already have an account, and having it rank for the brand name only sends
  // new visitors to a password-recovery box instead of the pitch.
  alternates: { canonical: "/forgot-password" },
};

/**
 * The forgotten-password form lives in the landing page's auth modal. This
 * route exists because the link is the kind that gets pasted into help replies
 * and typed from memory, and because a mail client that linkifies
 * "/forgot-password" out of our own reset email must not land on a 404.
 *
 * `?next=` is carried through the same way /login carries it: whatever sent
 * someone here wanted them somewhere afterwards, and the landing page
 * re-validates it as an internal path before using it.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=forgot&next=${encodeURIComponent(next)}` : "/?auth=forgot");
}
