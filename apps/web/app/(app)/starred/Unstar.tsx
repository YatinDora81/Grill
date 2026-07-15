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
      className="font-mono text-[11px] text-ink-muted underline underline-offset-4 transition-colors hover:text-weak disabled:opacity-40"
    >
      {busy ? "Removing…" : "Remove"}
    </button>
  );
}
