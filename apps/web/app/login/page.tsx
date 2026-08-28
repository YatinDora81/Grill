import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Grill to run a mock interview or read a past report.",
  alternates: { canonical: "/login" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/?auth=login&next=${encodeURIComponent(next)}` : "/?auth=login");
}
