import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  // proxy.ts gates this, but a Server Component reading the DB re-checks rather
  // than trusting the gate.
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/profile");

  const user = await repo.getUserById(userId);
  if (!user) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="font-display text-4xl">Profile</h1>
      <p className="mt-1.5 text-sm text-ink-soft">Your details, and your password.</p>
      <ProfileForm user={toUserDTO(user)} />
    </main>
  );
}
