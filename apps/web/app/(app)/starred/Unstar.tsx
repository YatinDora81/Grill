"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete } from "@/lib/apiClient";

/** Remove a question from the collection. */
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
          // The list is a Server Component; refreshing is what drops the row.
          router.refresh();
        } catch {
          setBusy(false);
        }
      }}
      // The same square chip as the row's other action, one tone quieter: this
      // is the destructive one, so it earns the weak colour only on hover — a
      // red control sitting next to every question would read as an error state.
      className="border border-line px-3 py-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-muted transition-colors hover:border-weak hover:text-weak disabled:opacity-40"
    >
      {busy ? "Removing…" : "Remove"}
    </button>
  );
}
