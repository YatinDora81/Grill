import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { NewInterviewForm } from "./NewInterviewForm";

export const metadata: Metadata = {
  title: "New interview",
  description: "Set the brief — role, difficulty and source — and start a mock interview.",
};

export default function NewInterviewPage() {
  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap" style={{ paddingBottom: 64 }}>
        <div className="page-head">
          <div>
            <h1 className="h1">
              Set the <i>brief.</i>
            </h1>
            <p className="page-sub">The more real the source, the sharper the questions.</p>
          </div>
        </div>

        <NewInterviewForm />
      </main>
    </>
  );
}
