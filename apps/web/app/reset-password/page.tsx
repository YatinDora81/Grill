import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Set a new password on your Grill account.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="grill-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap flex min-h-dvh items-center justify-center py-12">
        <div className="modal">
          <div className="modal-top">
            <Link href="/" className="wordmark uppercase" aria-label="Grill home">
              grill<i>.</i>
            </Link>
            <span className="font-mono text-[10.5px] tracking-[0.22em] uppercase text-ink-muted">
              <span className="text-ember" aria-hidden="true">
                /{" "}
              </span>
              Password reset
            </span>
          </div>

          {token ? (
            <>
              <div className="modal-head">
                <h1 className="modal-h">
                  Set a <span className="text-ember">new one.</span>
                </h1>
                <p className="modal-sub">
                  Pick something you&rsquo;ll remember. You&rsquo;re signed in the moment it saves.
                </p>
              </div>

              <ResetPasswordForm token={token} />
            </>
          ) : (
            <>
              <div className="modal-head">
                <h1 className="modal-h">
                  This link is <span className="text-ember">incomplete.</span>
                </h1>
                <p className="modal-sub">
                  There&rsquo;s no reset token on this address. Some mail clients break long links
                  across lines — open the one in the email directly, or ask for a fresh one.
                </p>
              </div>

              <div className="mform">
                <Link href="/?auth=forgot" className="btn btn-primary btn-lg btn-block">
                  Request a new link
                </Link>
                <p className="modal-sub">
                  Know the password after all?{" "}
                  <Link href="/?auth=login" className="link-ember">
                    Log in
                  </Link>
                  .
                </p>
              </div>
            </>
          )}

          <p className="modal-fine">
            <b>single use</b> · this link stops working once a password is saved
          </p>
        </div>
      </main>
    </div>
  );
}
