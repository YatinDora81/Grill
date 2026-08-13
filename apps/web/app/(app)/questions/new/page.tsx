import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { ExplainBanner } from "@/components/Explain";
import { QuestionSetForm } from "./QuestionSetForm";

export const metadata: Metadata = {
  title: "Generate questions",
  description: "Pick a source, a difficulty and a count — get just the questions.",
};

export default function NewQuestionSetPage() {
  return (
    <>
      <Reveal threshold={0.1} />
      <div className="keylight" aria-hidden="true" />

      <main className="wrap pb-16">
        <div className="page-head">
          <div>
            <p className="kicker">03 — Question bank</p>
            {/* Hard break, same reasoning as /new: all-caps display wraps
                unpredictably under a ch cap. */}
            <h1 className="h1 mt-4">
              Just the questions,
              <br />
              none of the heat.
            </h1>
            <p className="page-sub max-w-[54ch]">
              What to draw from, how hard, and how many. No interview starts — you get a list to
              read, and it waits for you.
            </p>
          </div>
        </div>

        {/* Same explain: gate as /new — a plain spacer would leave its margin
            behind on every non-explain view. */}
        <div className="hidden pt-8 explain:block">
          <ExplainBanner />
        </div>

        <QuestionSetForm />
      </main>
    </>
  );
}
