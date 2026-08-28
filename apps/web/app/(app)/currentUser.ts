import "server-only";
import { cache } from "react";
import type { User } from "@repo/types";
import { getUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export const currentUser = cache(async (): Promise<User | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const row = await repo.getUserById(userId);
  return row ? toUserDTO(row) : null;
});

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
