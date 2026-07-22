import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Grill to run a mock interview or read a past report.",
  // Inherits the root's noindex, deliberately: a login form ranks for the brand
  // name and sends people who wanted the pitch to a password box. Signup, which
  // is a real entry point, opts back in.
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  // useSearchParams (for ?next=) needs a Suspense boundary to prerender.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
