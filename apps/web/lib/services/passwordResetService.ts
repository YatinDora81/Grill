import "server-only";
/**
 * Forgotten-password flow. The raw token exists in exactly two places: the mail
 * we send and the link in the user's hands. What we keep is its sha256 digest,
 * so a database leak hands over spent hashes rather than live reset links.
 */
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { config } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { mailConfigured, sendMail } from "@/lib/mail/mailer";
import { renderPasswordResetEmail } from "@/lib/mail/templates/passwordReset";

/** 256 bits of entropy — a reset link must not be guessable inside its hour. */
const TOKEN_BYTES = 32;

const digest = (rawToken: string) => createHash("sha256").update(rawToken).digest("hex");

/**
 * Always resolves — never reveals whether the address is registered.
 *
 * "Never reveals" has to hold for failures too, which is why EVERYTHING after
 * the lookup sits inside one try. Only the registered branch mints a token,
 * renders a document and talks to an SMTP server, so leaving any of it unguarded
 * means a DB blip or a dead mailer produces a 500 for a real address and a clean
 * 200 for an unknown one — a reliable enumeration oracle, reachable by anyone who
 * can make the infrastructure hiccup.
 *
 * The caller must also keep this OFF the response path (`after()`), or the same
 * answer arrives at measurably different times for the two cases.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await repo.getUserByEmail(email);
  // No such account: mint nothing, send nothing, and return exactly as we would
  // have for a real one. The caller answers 200 either way — the same care
  // /api/auth/login already takes with its generic failure.
  if (!user) return;

  try {
    // Every previous link for this account dies as this one is born. Without it
    // each request stacks another live token — one an attacker triggered would
    // sit valid beside the victim's newest for the rest of the hour — and the
    // reset screen tells the user in as many words that a newer request kills
    // the older one.
    //
    // Not a hard invariant: the caller runs this in `after()`, so two requests
    // fired within the same tick can interleave their invalidate/create and
    // both survive. Verified sequentially (which is the human case) and bounded
    // by the route's 5-per-15-minutes limit either way; a strict guarantee would
    // need the pair in one transaction, which isn't worth serialising for.
    await repo.invalidateUserResetTokens(user.id);

    const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
    const ttlMinutes = config.mail.resetTokenTtlMinutes;
    await repo.createPasswordResetToken({
      userId: user.id,
      tokenHash: digest(rawToken),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    // The origin is config.site.url and never a Host header: the header is
    // attacker-controlled, so a link built from it could be pointed at the
    // attacker's own domain and would carry the victim's token there.
    const resetUrl = `${config.site.url}/reset-password?token=${rawToken}`;

    if (!mailConfigured()) {
      // Gated on the ENVIRONMENT, not on `mailConfigured()` alone. env.ts only
      // warns when SMTP is unset, so a production deploy that forgets those two
      // variables reaches this branch — and printing the link there would write
      // live, single-use account-takeover credentials into a log stream whose
      // readership is far wider than the database's. Locally it is the thing
      // that makes the flow testable with no SMTP account at all.
      if (process.env.NODE_ENV === "production") {
        console.error("[password-reset] mail is not configured — no reset email was sent.");
      } else {
        console.warn(`[password-reset] mail not configured — reset link: ${resetUrl}`);
      }
      return;
    }

    await sendMail({
      to: user.email,
      ...renderPasswordResetEmail({ name: user.name, resetUrl, expiresInMinutes: ttlMinutes }),
    });
  } catch (err) {
    // Swallowed on purpose — see the docblock. Logged because a silently dead
    // mailer is otherwise invisible: the endpoint answers 200 either way.
    console.error("[password-reset] request failed:", err);
  }
}

/**
 * One message and one code for every way a token can fail. Distinguishing
 * "expired" from "unknown" is an oracle — it confirms the token was real, and
 * to anyone holding a stolen link that is worth more than the sliver of UX it
 * would buy the genuine user.
 */
const invalidToken = () =>
  badRequest(
    "That reset link is invalid or has expired. Request a new one.",
    "invalid_reset_token",
  );

/** Returns the userId whose password was changed. Throws AppError on a bad/expired/used token. */
export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const row = await repo.findPasswordResetToken(digest(token));
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw invalidToken();

  // Hashed BEFORE the token is consumed, not after. argon2 is the slowest and
  // most failure-prone step here (it is memory-hard, and a starved serverless
  // instance is exactly where it gives out); doing it after the consume would
  // mean a throw leaves the token permanently spent with the password unchanged,
  // and the only link the user has now answers "invalid or has expired" — which
  // is not what happened and gives them nothing to act on.
  //
  // Ordering it first costs nothing: the atomic consume below is still the thing
  // that decides who wins, so single-use is untouched.
  //
  // No "must differ from your current password" check here, unlike
  // /api/profile/password. Enforcing it means verifying the new password
  // against the stored hash, and the user is on this path precisely because
  // they don't know the password that hash belongs to.
  const passwordHash = await hashPassword(newPassword);

  // `false` means someone consumed it between that read and this write — a
  // double-submitted form, or the same link opened twice. Same rejection: the
  // token is spent, and only the caller who won gets to set the password.
  if (!(await repo.consumePasswordResetToken(row.id))) throw invalidToken();

  await repo.updateUserPassword(row.userId, passwordHash);

  // Belt and braces: every other outstanding link for this account dies with
  // this reset, including any an attacker requested earlier.
  await repo.invalidateUserResetTokens(row.userId);

  return row.userId;
}
