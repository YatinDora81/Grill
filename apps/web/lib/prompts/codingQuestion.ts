import type { CodeSubmission, CodingQuestionPayload } from "@repo/types";
import { DIFFICULTY_META, personaBrief } from "@/lib/interviewMeta";
import type { QuestionInputs, SessionContext } from "./questionGen";

export const CODING_SYSTEM = `You write ONE coding-interview problem at a time for a mock interview.
Hard contract:
- Solvable in 20 minutes by the stated difficulty. Python 3 or JavaScript.
- Programs read ALL input from stdin and write ONLY the answer to stdout. No function-signature
  harness, no interactive prompts. Python: input() / sys.stdin. JavaScript: the runner provides
  readLine() → string|null and readAll() → string; print with console.log.
- "output" of every example and hidden test is EXACTLY what a correct program prints (trailing
  newline ignored). Inputs and outputs are plain text, one value per line unless the prompt says otherwise.
- Hidden tests cover edge cases the examples do not (empty input, single element, duplicates, large N).
- The problem is grounded in the candidate's context when possible (their stack, their domain) but
  must stand alone. No trick questions, no obscure algorithms at easy/medium.
- Starter code is minimal: reading input and a TODO. Never include the solution.
Respond with JSON only — no prose, no code fences.`;

export function codingQuestionPrompt(
  s: SessionContext,
  inputs: QuestionInputs,
  index: number,
  total: number,
): string {
  const heat = DIFFICULTY_META[s.config.difficulty];
  const persona = personaBrief(s.config.persona);
  const material = [
    s.config.topic ? `Topic: ${s.config.topic}` : "",
    s.config.job_description ? `Job description:\n${s.config.job_description.slice(0, 4_000)}` : "",
    s.sourceText ? `Résumé:\n${s.sourceText.slice(0, 6_000)}` : "",
    s.config.project_context ? `Project:\n${s.config.project_context.slice(0, 4_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const asked = inputs.askedBefore?.length
    ? `\nDo not repeat these problems (titles/prompts asked before):\n${inputs.askedBefore
        .slice(0, 40)
        .map((q) => `- ${q.slice(0, 160)}`)
        .join("\n")}\n`
    : "";
  return `Problem ${index + 1} of ${total}. Difficulty: ${heat.label} — ${heat.pitch}
${persona}
Role: ${s.role ?? "software engineer"}

Candidate context:
${material || "(none — pick a general problem)"}
${asked}
Return JSON with exactly:
{
  "title": string,
  "prompt_markdown": string,           // problem statement with an "Input" and "Output" section; markdown; no solution
  "examples": [{ "input": string, "output": string, "explanation": string }],   // 1–3
  "hidden_tests": [{ "input": string, "output": string }],                      // 2–6
  "starter": { "python": string, "javascript": string },
  "complexity_target": string          // e.g. "O(n log n) time, O(n) extra space"
}`;
}

export const CODE_REVIEW_SYSTEM = `You grade a coding-interview submission. You are given the problem, the
candidate's code, the measured test results and the transcript of what they said while coding.
Score 0–10 per dimension, JSON only:
- relevance: does the code attack the stated problem (not a different one)?
- correctness: anchor on the measured results — all tests passing is 8–10 (10 only if the approach is
  right, not brute force beyond the target), none passing is 0–3; partial in between. Never override a
  failing test with your own opinion.
- structure: naming, decomposition, readability, no dead code.
- depth: edge cases handled, meets the complexity target, spoken reasoning shows understanding.
- filler: 10 minus penalties for leftover debug prints, commented-out junk, copy-paste noise.
No prose, no code fences.`;

export function codeReviewPrompt(
  q: CodingQuestionPayload,
  sub: CodeSubmission,
  spoken: string,
): string {
  const results = sub.results
    .map(
      (r) =>
        `- ${r.kind} #${r.index}: ${r.timed_out ? "TIMED OUT" : r.passed ? "pass" : "FAIL"} (${r.time_ms} ms)${
          r.passed
            ? ""
            : `\n    expected: ${r.expected.slice(0, 200)}\n    got: ${r.stdout.slice(0, 200)}${
                r.stderr ? `\n    stderr: ${r.stderr.slice(0, 300)}` : ""
              }`
        }`,
    )
    .join("\n");
  return `Problem: ${q.title}
${q.prompt_markdown}
Complexity target: ${q.complexity_target || "unspecified"}

Language: ${sub.language}
Measured results: ${sub.passed}/${sub.total} passed
${results}

Code:
\`\`\`${sub.language}
${sub.source.slice(0, 12_000)}
\`\`\`

Spoken while coding (${sub.think_aloud_pct ?? "unmeasured"}% of the time talking):
${spoken.trim() || "(said nothing)"}

Respond with JSON: {"relevance": n, "correctness": n, "structure": n, "depth": n, "filler": n}`;
}

export function codeFollowUpPrompt(
  q: CodingQuestionPayload,
  sub: CodeSubmission | null,
  spoken: string,
): string {
  const failed = sub?.results.filter((r) => !r.passed) ?? [];
  return `The candidate just finished this problem: ${q.title}
${
  sub
    ? `They wrote ${sub.language}; ${sub.passed}/${sub.total} tests passed${
        failed.length ? `; failing: ${failed.map((f) => `${f.kind} #${f.index}`).join(", ")}` : ""
      }.`
    : "They submitted nothing."
}
${sub ? `Their code:\n\`\`\`${sub.language}\n${sub.source.slice(0, 6_000)}\n\`\`\`` : ""}
What they said while coding: ${spoken.trim().slice(0, 2_000) || "(nothing)"}

Ask ONE spoken follow-up about THEIR code — the time/space complexity of what they actually wrote,
the specific edge case that failed, or a trade-off they made. Reference a concrete line or decision.
One question, no preamble. JSON: {"question": string, "question_type": "followup"}`;
}
