import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Ask Grill for a link to set a new password.",
  alternates: { canonical: "/forgot-password" },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=forgot&next=${encodeURIComponent(next)}` : "/?auth=forgot");
}
