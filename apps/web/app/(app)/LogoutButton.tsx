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
      router.push("/");
      router.refresh();
    }
  }

  return (
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
