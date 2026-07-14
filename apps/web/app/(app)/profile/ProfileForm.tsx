"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, Card, ErrorNote, Eyebrow, Field, Input, Spinner } from "@/components/ui";
import { GrillToaster } from "@/components/toast";

async function apiPatch<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiClientError(
      body?.error?.message ?? "Something went wrong.",
      body?.error?.code ?? "unknown",
      res.status,
    );
  }
  return body as T;
}

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();

  const [name, setName] = useState(user.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState("");

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Give us something to call you.");
      return;
    }
    setSavingName(true);
    setNameError("");
    try {
      await apiPatch<User>("/api/profile", { name: name.trim() });
      toast.success("Saved");
      // The name is server-rendered in the greeting — refresh so it updates.
      router.refresh();
    } catch (err) {
      setNameError(err instanceof ApiClientError ? err.message : "Couldn't save that.");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    // Checked here as well as server-side: a typo in a field you can't read
    // should not cost a round trip to find out about.
    if (next !== confirm) {
      setPwError("The new passwords don't match.");
      return;
    }
    setSavingPw(true);
    setPwError("");
    try {
      await apiPost("/api/profile/password", {
        current_password: current,
        new_password: next,
      });
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setPwError(err instanceof ApiClientError ? err.message : "Couldn't change it.");
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <GrillToaster />

      <Card className="p-5">
        <Eyebrow>Details</Eyebrow>
        <form onSubmit={saveName} className="mt-4 space-y-4">
          <Field label="Name" htmlFor="name" hint="What the dashboard calls you.">
            <Input
              id="name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Yatin"
            />
          </Field>

          <Field label="Email" htmlFor="email" hint="Sign-in address — not changeable here.">
            <Input id="email" value={user.email} disabled readOnly />
          </Field>

          <ErrorNote>{nameError}</ErrorNote>

          <Button type="submit" disabled={savingName}>
            {savingName ? <Spinner /> : null}
            {savingName ? "Saving…" : "Save"}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <Eyebrow>Password</Eyebrow>
        <form onSubmit={savePassword} className="mt-4 space-y-4">
          <Field label="Current password" htmlFor="current">
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="next" hint="At least 8 characters.">
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          <ErrorNote>{pwError}</ErrorNote>

          <Button type="submit" disabled={savingPw || !current || !next || !confirm}>
            {savingPw ? <Spinner /> : null}
            {savingPw ? "Changing…" : "Change password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
