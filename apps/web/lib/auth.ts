import "server-only";
/**
 * Auth (Grill §Accounts & auth). Email + password → argon2id hash → JWT in an
 * httpOnly Secure SameSite=Lax cookie. Stateless. Secrets from env only.
 */
import { cache } from "react";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { User as UserRow } from "@repo/db";
import type { User } from "@repo/types";
import { config } from "./env";
import { unauthorized } from "./errors";
import * as repo from "./db/repo";

const secret = new TextEncoder().encode(config.auth.jwtSecret);

export function hashPassword(password: string): Promise<string> {
  return hash(password); // @node-rs/argon2 defaults to argon2id
}
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export async function signJwt(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${config.auth.cookieMaxAgeS}s`)
    .sign(secret);
}

/** Edge-safe verify (also used by middleware). Returns the userId or null. */
export async function verifyJwt(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await signJwt(userId);
  const store = await cookies();
  store.set(config.auth.cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: config.auth.cookieMaxAgeS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(config.auth.cookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Whether the user still exists. Cached per request, so the callers that go on
 * to load the same row (dashboard, profile) don't pay for a second lookup.
 */
const userExists = cache(async (userId: string): Promise<boolean> => {
  return Boolean(await repo.getUserById(userId));
});

/** Read + verify the cookie. Returns the userId, or null if not authenticated. */
export async function getUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(config.auth.cookieName)?.value;
  if (!token) return null;
  const userId = await verifyJwt(token);
  if (!userId) return null;
  // A token that verifies but names a user who no longer exists (deleted
  // account, or a cookie outliving the database it was issued against) is a
  // ghost session. The signature alone can't tell us that, so without this
  // check every caller sails past its auth guard on a userId that resolves to
  // nothing and throws `unknown_user` — a 500 where the honest answer is
  // "you're signed out". `proxy.ts` still verifies signature-only: it's the UX
  // gate and stays off the database.
  return (await userExists(userId)) ? userId : null;
}

/** Require an authenticated user; throws 401 otherwise. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw unauthorized();
  return userId;
}

export function toUserDTO(u: UserRow): User {
  return { id: u.id, email: u.email, name: u.name };
}
