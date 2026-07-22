import "server-only";
import { cache } from "react";
import type { User } from "@repo/types";
import { getUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

/**
 * The signed-in user, for chrome that needs a name (the topbar's initials).
 *
 * `cache` so the layout and any page in the group that asks share one round
 * trip per request rather than one each.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const row = await repo.getUserById(userId);
  return row ? toUserDTO(row) : null;
});

/** Two letters for the avatar, or a shrug when the account has no name. */
export function initialsOf(name: string | null): string {
  if (!name?.trim()) return "?";
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
