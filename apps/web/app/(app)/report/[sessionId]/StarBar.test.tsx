import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { StarBreakdown, StarSegment } from "@repo/types";

const { StarBar } = await import("./StarBar");

function seg(label: StarSegment["label"], start: number, end: number, text = "…"): StarSegment {
  return { label, start, end, text };
}

function breakdown(over: Partial<StarBreakdown> = {}): StarBreakdown {
  return {
    turn_index: 3,
    basis: "time",
    segments: [
      seg("S", 0, 60, "We were three weeks from a launch."),
      seg("A", 60, 100),
      seg("R", 100, 100),
    ],
    share: { S: 60, T: 0, A: 40, R: 0, other: 0 },
    missing: ["T", "R"],
    note: "Two thirds of this answer is scene-setting.",
    ...over,
  };
}

function bars(container: HTMLElement): HTMLElement[] {
  const bar = container.querySelector('[role="img"]');
  return Array.from(bar?.children ?? []) as HTMLElement[];
}

describe("nothing to draw", () => {
  test("a turn with no breakdown renders nothing at all", () => {
    const { container } = render(<StarBar breakdown={null} />);
    expect(container.firstChild).toBeNull();
  });

  test("a breakdown with no segments renders nothing", () => {
    const { container } = render(<StarBar breakdown={breakdown({ segments: [] })} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("the bar", () => {
  test("segments run in the order they were said, sized by their real share", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    const spans = bars(container);

    expect(spans).toHaveLength(2);
    expect(spans[0]!.style.width).toBe("60%");
    expect(spans[1]!.style.width).toBe("40%");
  });

  test("each segment carries its part, its position and its own words", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    const title = bars(container)[0]!.getAttribute("title") ?? "";

    expect(title).toContain("Situation");
    expect(title).toContain("0:00–1:00");
    expect(title).toContain("We were three weeks from a launch.");
  });

  test("a typed answer measures itself in words, not in a clock", () => {
    const { container } = render(
      <StarBar
        breakdown={breakdown({
          basis: "words",
          segments: [seg("S", 0, 12, "I owned the migration.")],
          share: { S: 100, T: 0, A: 0, R: 0, other: 0 },
        })}
      />,
    );

    expect(bars(container)[0]!.getAttribute("title")).toContain("words 1–12");
  });

  test("the shared report can draw the same bar without quoting a word of the answer", () => {
    const { container } = render(<StarBar breakdown={breakdown()} showQuotes={false} />);
    const title = bars(container)[0]!.getAttribute("title") ?? "";

    expect(title).toBe("Situation · 0:00–1:00");
    expect(container.textContent).not.toContain("three weeks from a launch");
  });

  test("the whole split is one label for a screen reader", () => {
    const { getByRole } = render(<StarBar breakdown={breakdown()} />);
    const label = getByRole("img").getAttribute("aria-label") ?? "";

    expect(label).toContain("Situation 60%");
    expect(label).toContain("Result 0%");
  });

  test("a clip whose words share one timestamp still draws, split evenly", () => {
    const { container } = render(
      <StarBar
        breakdown={breakdown({
          segments: [seg("S", 4, 4), seg("A", 4, 4)],
          share: { S: 50, T: 0, A: 50, R: 0, other: 0 },
          missing: ["T", "R"],
        })}
      />,
    );

    expect(bars(container).map((s) => s.style.width)).toEqual(["50%", "50%"]);
  });
});

describe("the legend and the verdict", () => {
  test("all four parts are listed even at zero, so an absence is visible", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Situation 60%");
    expect(text).toContain("Task 0%");
    expect(text).toContain("Action 40%");
    expect(text).toContain("Result 0%");
  });

  test("a part under a tenth of the answer is toned as the weakness it is", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    const weak = Array.from(container.querySelectorAll(".tone-weak")).map((e) => e.textContent);

    expect(weak).toContain("Task 0%");
    expect(weak).toContain("Result 0%");
    expect(weak.some((t) => t?.startsWith("Situation"))).toBe(false);
  });

  test("`other` only appears when some of the answer actually served no part", () => {
    const { container: without } = render(<StarBar breakdown={breakdown()} />);
    expect(without.textContent).not.toContain("Other");

    const { container: with_ } = render(
      <StarBar
        breakdown={breakdown({
          segments: [seg("S", 0, 50), seg("other", 50, 100)],
          share: { S: 50, T: 0, A: 0, R: 0, other: 50 },
        })}
      />,
    );
    expect(with_.textContent).toContain("Other 50%");
  });

  test("a share with a fraction keeps it, a whole one stays whole", () => {
    const { container } = render(
      <StarBar
        breakdown={breakdown({
          share: { S: 62.5, T: 8, A: 25.5, R: 4, other: 0 },
          missing: [],
        })}
      />,
    );

    expect(container.textContent).toContain("Situation 62.5%");
    expect(container.textContent).toContain("Task 8%");
  });

  test("missing parts get a chip each, named in full", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    const chips = Array.from(container.querySelectorAll(".chip-error")).map((e) => e.textContent);

    expect(chips).toEqual(["No Task", "No Result"]);
  });

  test("a complete answer gets no chips", () => {
    const { container } = render(<StarBar breakdown={breakdown({ missing: [] })} />);
    expect(container.querySelectorAll(".chip-error")).toHaveLength(0);
  });

  test("the model's one dry sentence is shown as written", () => {
    const { container } = render(<StarBar breakdown={breakdown()} />);
    expect(container.textContent).toContain("Two thirds of this answer is scene-setting.");
  });
});
