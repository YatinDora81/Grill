import { test, expect, describe, mock } from "bun:test";
import { render, fireEvent, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { ExclusiveMode } from "@repo/types";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const router = {
  push: mock(() => {}),
  replace: mock(() => {}),
  refresh: mock(() => {}),
  back: mock(() => {}),
  forward: mock(() => {}),
  prefetch: mock(() => {}),
};
mock.module("next/navigation", () => ({ useRouter: () => router }));

const { NewInterviewForm } = await import("./NewInterviewForm");
const { default: NewInterviewPage } = await import("./page");
const { MODE_META, SOURCE_META } = await import("@/lib/interviewMeta");

interface FormProps {
  initialMode?: ExclusiveMode | null;
  initialStarredHashes?: string[];
}

function findForm(node: ReactNode): FormProps | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findForm(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === NewInterviewForm) return el.props as FormProps;
  return findForm(el.props.children ?? null);
}

async function formPropsFor(params: Record<string, string>): Promise<FormProps> {
  const tree = await NewInterviewPage({ searchParams: Promise.resolve(params) });
  const props = findForm(tree);
  if (!props) throw new Error("the page rendered no NewInterviewForm");
  return props;
}

describe("the mode a link asks /new for", () => {
  test("the report mail's rematch link arrives as a seeded mode", async () => {
    expect((await formPropsFor({ mode: "weak_spots" })).initialMode).toBe("weak_spots");
  });

  test("every other exclusive mode survives the trip too", async () => {
    expect((await formPropsFor({ mode: "jd" })).initialMode).toBe("jd");
    expect((await formPropsFor({ mode: "project" })).initialMode).toBe("project");
  });

  test("a mode that isn't one is dropped", async () => {
    expect((await formPropsFor({ mode: "definitely_not_a_mode" })).initialMode).toBe(null);
    expect((await formPropsFor({})).initialMode).toBe(null);
  });

  test("the starred drill link still arrives as hashes, not as a mode", async () => {
    const h = "a".repeat(64);
    const props = await formPropsFor({ mode: "starred", h });
    expect(props.initialStarredHashes).toEqual([h]);
    expect(props.initialMode).toBe(null);
  });

  test("starred with no usable hashes stays the ordinary form", async () => {
    const props = await formPropsFor({ mode: "starred", h: "nope" });
    expect(props.initialStarredHashes).toEqual([]);
    expect(props.initialMode).toBe(null);
  });
});

describe("a form opened on a seeded mode", () => {
  test("draws on that mode rather than the résumé blend", () => {
    const { getByText } = render(<NewInterviewForm initialMode="weak_spots" />);
    expect(getByText("Draws on").parentElement?.textContent).toContain(MODE_META.weak_spots.label);
  });

  test("without one it still opens on the résumé blend", () => {
    const { getByText } = render(<NewInterviewForm />);
    expect(getByText("Draws on").parentElement?.textContent).toContain(SOURCE_META.resume.label);
  });

  test("the picker shows it already chosen", () => {
    const { getByRole } = render(<NewInterviewForm initialMode="weak_spots" />);
    fireEvent.click(getByRole("button", { name: /^Next/ }));
    const modes = within(getByRole("radiogroup", { name: "Interview mode" }));
    const chosen = modes
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.textContent).toContain(MODE_META.weak_spots.label);
  });
});
