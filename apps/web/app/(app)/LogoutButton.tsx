"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await apiPost("/api/auth/logout", {});
    } finally {
      // Even if the call failed, send them to the door — a logout that appears
      // to do nothing is worse than one that redirects with a stale cookie.
      // The landing page, not the sign-in modal: someone who just signed out is
      // not asking to sign back in.
      router.push("/");
      router.refresh();
    }
  }

  return (
    /* A bare mono label, not a `.btn`. The reference rail foot is two marks — the
       account tile and the explain switch — and a third bordered box under them
       gave sign-out the same weight as the mode that changes every screen. It
       stays a real button for the keyboard and for `disabled`; only the box is
       gone. */
    <button
      type="button"
      className={`text-left font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-55 ${className ?? ""}`}
      onClick={logout}
      disabled={busy}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
