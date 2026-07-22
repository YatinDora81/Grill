"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";

export function LogoutButton() {
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
    <button type="button" className="btn btn-ghost btn-sm" onClick={logout} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
