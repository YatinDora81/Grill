import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Set a new password on your Grill account.",
  // Restated rather than left to the root default: a password form that turns
  // up in search results is a phishing lure with our own domain attached, and
  // the URLs that reach this page carry a live token in the query string.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * A real page, not the auth modal.
 *
 * Everything else in the signed-out flow happens in a dialog over the landing
 * page, and this one deliberately doesn't: someone arriving from their inbox
 * has just followed a link from an email and is being asked for a password. A
 * modal floating over a marketing page is exactly what a phishing screen looks
 * like. This looks like the product, at its own URL.
 *
 * The token stays in the URL and is never put in a hidden input — the form
 * posts it straight back to /api/auth/reset-password, which is the only party
 * that can do anything with it.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  // `string[]` is not defensive typing — Next hands back an array whenever a key
  // repeats, and mail clients and link scanners really do rewrite and re-append
  // query strings. Left as-is the array reaches `apiPost`, serialises as a JSON
  // array, and the route rejects it with a raw zod message under
  // `validation_error` — which is not the code the form's terminal
  // "request a new link" state keys off, so the user is stuck retyping a
  // password on a form that can never succeed.
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="grill-root">
      <div className="grain" aria-hidden="true" />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap flex min-h-dvh items-center justify-center py-12">
        <div className="modal">
          {/* Wordmark rather than the auth modal's mono slug: this is a real
              page reached from an email, and the one thing worth saying at the
              top of it is whose product it is. `uppercase` is safe as a utility
              — `.wordmark` never declares `text-transform`, so nothing
              unlayered outranks it. */}
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
                {/* Flat ember, not `.flame`: that class fills the word with a
                    gradient, and the redesign has one gradient in it and it
                    isn't type. */}
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
            /* No token at all — a bookmarked /reset-password, or a mail client
               that wrapped the link and cut the query string off it. Say so
               plainly and hand back the one action that helps; a password form
               with nothing to submit against is a dead end dressed as a page. */
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
