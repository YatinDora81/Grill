"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete } from "@/lib/apiClient";

export function Unstar({ questionHash }: { questionHash: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      aria-label="Remove from starred questions"
      onClick={async () => {
        setBusy(true);
        try {
          await apiDelete("/api/starred", { question_hash: questionHash });
          router.refresh();
        } catch {
          setBusy(false);
        }
      }}
      className="border border-line px-3 py-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-muted transition-colors hover:border-weak hover:text-weak disabled:opacity-40"
    >
      {busy ? "Removing…" : "Remove"}
    </button>
  );
}
