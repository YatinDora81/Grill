import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { config } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { mailConfigured, sendMail } from "@/lib/mail/mailer";
import { renderPasswordResetEmail } from "@/lib/mail/templates/passwordReset";

const TOKEN_BYTES = 32;

const digest = (rawToken: string) => createHash("sha256").update(rawToken).digest("hex");

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await repo.getUserByEmail(email);
  if (!user) return;

  try {
    await repo.invalidateUserResetTokens(user.id);

    const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
    const ttlMinutes = config.mail.resetTokenTtlMinutes;
    await repo.createPasswordResetToken({
      userId: user.id,
      tokenHash: digest(rawToken),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    const resetUrl = `${config.site.url}/reset-password?token=${rawToken}`;

    if (!mailConfigured()) {
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
    console.error("[password-reset] request failed:", err);
  }
}

const invalidToken = () =>
  badRequest(
    "That reset link is invalid or has expired. Request a new one.",
    "invalid_reset_token",
  );

export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const row = await repo.findPasswordResetToken(digest(token));
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw invalidToken();

  const passwordHash = await hashPassword(newPassword);

  if (!(await repo.consumePasswordResetToken(row.id))) throw invalidToken();

  await repo.updateUserPassword(row.userId, passwordHash);

  await repo.invalidateUserResetTokens(row.userId);

  return row.userId;
}
