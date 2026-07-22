import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Grill to run a mock interview or read a past report.",
  // Inherits the root's noindex, deliberately: a login form ranks for the brand
  // name and sends people who wanted the pitch to a password box. Signup, which
  // is a real entry point, opts back in.
  alternates: { canonical: "/login" },
};

/**
 * Auth lives in a modal on the landing page now. This route stays so that old
 * links, bookmarks and anything still pointing at /login land on the form rather
 * than a 404 — the landing page reads ?auth= on mount and opens it.
 *
 * `?next=` is carried through rather than dropped: a bookmarked
 * `/login?next=/report/abc` is precisely the link that exists to send someone
 * somewhere, and the landing page re-validates it as an internal path anyway.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=login&next=${encodeURIComponent(next)}` : "/?auth=login");
}
