"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";
import { Button } from "@/components/ui";

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
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={logout} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
