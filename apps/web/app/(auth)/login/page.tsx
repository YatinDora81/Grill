import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  // useSearchParams (for ?next=) needs a Suspense boundary to prerender.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
