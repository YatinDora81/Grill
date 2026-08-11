import { test, expect, describe, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { ResumeGapResponse } from "@repo/types";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const RESULT: ResumeGapResponse = {
  match_percent: 61,
  summary: "Worth applying, with prep.",
  covered: [{ requirement: "React and TypeScript", evidence: "built Grill" }],
  gaps: [
    {
      requirement: "Observability and on-call",
      why_it_matters: "They page whoever owns the service.",
      how_to_close: "Add Sentry, then write the incident story.",
    },
  ],
};

class FakeApiClientError extends Error {}

mock.module("@/lib/apiClient", () => ({
  apiPostForm: async () => RESULT,
  ApiClientError: FakeApiClientError,
}));

let signedInCookie = false;
mock.module("@/lib/auth", () => ({
  getUserId: async () => (signedInCookie ? "user_1" : null),
}));

const { GapForm } = await import("./GapForm");
const { default: ResumeVsJdPage } = await import("./page");

interface GapFormProps {
  signedIn: boolean;
}

function findGapForm(node: ReactNode): GapFormProps | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findGapForm(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === GapForm) return el.props as GapFormProps;
  return findGapForm(el.props.children ?? null);
}

function typeInto(field: HTMLElement, value: string): void {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: "e" });
  fireEvent.blur(field);
}

async function ctaFor(signedIn: boolean): Promise<HTMLAnchorElement> {
  const view = render(<GapForm signedIn={signedIn} />);
  fireEvent.click(view.getByText("or paste the text instead"));
  typeInto(view.getByLabelText("Résumé"), "Six years of React and TypeScript, Postgres in prod.");
  typeInto(view.getByLabelText("Job description"), "Senior Backend Engineer — owns services.");
  fireEvent.click(view.getByRole("button", { name: "Find the gaps" }));
  return (await view.findByRole("link", {
    name: /Interview me on these gaps/,
  })) as HTMLAnchorElement;
}

describe("where the gap tool's result CTA sends you", () => {
  test("a signed-in visitor goes straight to the interview builder", async () => {
    expect((await ctaFor(true)).getAttribute("href")).toBe("/new");
  });

  test("a logged-out visitor still gets the signup step, carrying /new as next", async () => {
    expect((await ctaFor(false)).getAttribute("href")).toBe("/signup?next=%2Fnew");
  });

  test("the page reads the cookie rather than assuming everyone is logged out", async () => {
    signedInCookie = true;
    expect(findGapForm(await ResumeVsJdPage())?.signedIn).toBe(true);
    signedInCookie = false;
    expect(findGapForm(await ResumeVsJdPage())?.signedIn).toBe(false);
  });
});
