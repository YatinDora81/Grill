import type { Metadata } from "next";
import { NewInterviewForm } from "./NewInterviewForm";

export const metadata: Metadata = {
  title: "New interview",
  description:
    "Set the brief — role, difficulty and source — and start a mock interview.",
};

export default function NewInterviewPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-4xl tracking-tight">Set the brief</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        The more real the source, the sharper the questions.
      </p>
      <NewInterviewForm />
    </main>
  );
}
