"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { User } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";

/**
 * Shared login/signup form. Both endpoints set the session cookie and return
 * { user }, so the only real differences are the copy and the name field.
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Where the auth gate wanted to send us. Only accept internal paths — an
  // attacker-supplied ?next=https://evil.tld would otherwise make our own login
  // an open redirect.
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost<{ user: User }>(`/api/auth/${mode}`, {
        email,
        password,
        ...(isSignup && name.trim() ? { name: name.trim() } : {}),
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-4xl tracking-tight">
        {isSignup ? "Take the hot seat" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        {isSignup
          ? "Make an account and run your first interview in a couple of minutes."
          : "Log in to pick up where you left off."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {isSignup && (
          <Field label="Name" htmlFor="name" hint="Optional.">
            <Input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
            />
          </Field>
        )}

        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint={isSignup ? "At least 8 characters." : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? "One moment…" : isSignup ? "Create account" : "Log in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-ember underline underline-offset-4"
        >
          {isSignup ? "Log in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
