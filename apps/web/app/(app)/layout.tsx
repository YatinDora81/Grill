import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { LogoutButton } from "./LogoutButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* No fill: a raised bar reads as a brown band across the top. The room's
          chrome is the page colour plus a hairline, as in the reference. */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard">
            <Wordmark className="text-xl" />
          </Link>
          <nav className="flex items-center gap-5">
            <Link
              href="/profile"
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Profile
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
