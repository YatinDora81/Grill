import { expect, test } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import type { Comparison, MetricDelta } from "@repo/types";

const { ThenVsNow, RetryForward } = await import("./ThenVsNow");

function metric(patch: Partial<MetricDelta> = {}): MetricDelta {
  return {
    key: "filler_count",
    label: "Fillers",
    then: 12,
    now: 4,
    delta: -8,
    unit: "",
    better: "down",
    ...patch,
  };
}

function comparison(patch: Partial<Comparison> = {}): Comparison {
  return {
    parent_session_id: "s1",
    parent_name: "First go",
    parent_date: "2026-08-01T09:00:00.000Z",
    overall: {
      key: "overall",
      label: "Overall",
      then: 58,
      now: 70,
      delta: 12,
      unit: "",
      better: "up",
    },
    categories: [
      {
        key: "technical",
        label: "Technical",
        then: 60,
        now: 55,
        delta: -5,
        unit: "",
        better: "up",
      },
    ],
    delivery: [metric()],
    turns: [
      {
        turn_index: 0,
        question: "Why Postgres?",
        then_transcript: "we picked it because I knew it",
        now_transcript: "we picked it because it fit the writes",
        then_mean: 5,
        now_mean: 8,
        diff: [
          { op: "keep", text: "we picked it because" },
          { op: "del", text: "I knew it" },
          { op: "add", text: "it fit the writes" },
        ],
      },
    ],
    ...patch,
  };
}

test("the header points back at the run being compared against, dated in UTC", () => {
  const { getByRole } = render(<ThenVsNow comparison={comparison()} />);

  const link = getByRole("link", { name: /First go/ });
  expect(link.getAttribute("href")).toBe("/report/s1");
  expect(link.textContent).toContain("1 Aug 2026");
});

test("an improvement is green and a regression is red, whichever way the metric runs", () => {
  const { container } = render(
    <ThenVsNow
      comparison={comparison({
        delivery: [
          metric(),
          metric({
            key: "hnr_db",
            label: "Voice clarity",
            then: 18,
            now: 14,
            delta: -4,
            unit: " dB",
            better: "up",
          }),
        ],
      })}
    />,
  );

  const cells = [...container.querySelectorAll("span")].filter((el) =>
    /^[+−±]/.test(el.textContent ?? ""),
  );
  const byText = (text: string) => cells.find((el) => el.textContent === text)!;

  expect(byText("−8").className).toContain("tone-strong");
  expect(byText("−4 dB").className).toContain("tone-weak");
});

test("a descriptive metric shows its change without calling it good or bad", () => {
  const { container } = render(
    <ThenVsNow
      comparison={comparison({
        delivery: [
          metric({
            key: "wpm",
            label: "Pace",
            then: 120,
            now: 150,
            delta: 30,
            unit: " wpm",
            better: "none",
          }),
        ],
      })}
    />,
  );

  const cell = [...container.querySelectorAll("span")].find((el) => el.textContent === "+30 wpm")!;
  expect(cell.className).toContain("text-ink-muted");
  expect(cell.className).not.toContain("tone-strong");
});

test("a metric measured on one run only renders an em dash and no change", () => {
  const { container } = render(
    <ThenVsNow
      comparison={comparison({
        delivery: [
          metric({
            key: "on_camera_pct",
            label: "Looked at camera",
            then: null,
            now: 62,
            delta: null,
            unit: "%",
            better: "up",
          }),
        ],
      })}
    />,
  );

  const row = [...container.querySelectorAll("div")].find(
    (el) => el.firstElementChild?.textContent === "Looked at camera",
  )!;
  expect([...row.children].map((c) => c.textContent)).toEqual([
    "Looked at camera",
    "—",
    "62%",
    "—",
  ]);
});

test("a flat delta is drawn flat rather than as a near miss", () => {
  const { container } = render(
    <ThenVsNow comparison={comparison({ delivery: [metric({ then: 4, now: 4, delta: 0 })] })} />,
  );

  const cell = [...container.querySelectorAll("span")].find((el) => el.textContent === "±0")!;
  expect(cell.className).toContain("text-ink-muted");
});

test("the answer opens as a word diff, with removals and additions marked up as such", () => {
  const { container } = render(<ThenVsNow comparison={comparison()} />);

  expect(container.querySelector("del")?.textContent).toBe("I knew it");
  expect(container.querySelector("ins")?.textContent).toBe("it fit the writes");
  expect(container.textContent).toContain("we picked it because");
});

test("the toggle swaps the diff for the two answers whole, and back", () => {
  const { getByRole, container } = render(<ThenVsNow comparison={comparison()} />);

  const toggle = getByRole("button", { name: "Show both" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(toggle);

  expect(container.querySelector("del")).toBeNull();
  expect(container.textContent).toContain("we picked it because I knew it");
  expect(container.textContent).toContain("we picked it because it fit the writes");

  const back = getByRole("button", { name: "Show changes" });
  expect(back.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(back);
  expect(container.querySelector("del")).toBeTruthy();
});

test("an unscored answer shows a dash instead of a rubric mean", () => {
  const base = comparison();
  const { container } = render(
    <ThenVsNow
      comparison={comparison({ turns: [{ ...base.turns[0]!, then_mean: null, now_mean: 8 }] })}
    />,
  );

  const chips = [...container.querySelectorAll(".chip")].map((c) => c.textContent);
  expect(chips).toEqual(["then —", "now 8.0"]);
});

test("with no paired questions the section says so instead of rendering an empty toggle", () => {
  const { queryByRole, container } = render(<ThenVsNow comparison={comparison({ turns: [] })} />);

  expect(queryByRole("button", { name: "Show both" })).toBeNull();
  expect(container.textContent).toContain("nothing to lay side by side");
});

test("an unnamed parent still reads as a run rather than as a blank", () => {
  const { getByRole } = render(<ThenVsNow comparison={comparison({ parent_name: null })} />);

  expect(getByRole("link", { name: /earlier run/ })).toBeTruthy();
});

test("the retried run links into the comparison on its newest retry", () => {
  const { getByRole } = render(<RetryForward count={3} latestId="r3" latestScored />);

  const link = getByRole("link");
  expect(link.getAttribute("href")).toBe("/report/r3#compare");
  expect(link.textContent).toBe("Retried 3× — compare latest");
});

test("a single retry is counted in words rather than as a bare 1×", () => {
  const { getByRole } = render(<RetryForward count={1} latestId="r1" latestScored />);

  expect(getByRole("link").textContent).toBe("Retried once — compare latest");
});

test("an unscored retry is linked without promising a comparison that isn't there", () => {
  const { getByRole } = render(<RetryForward count={1} latestId="r1" latestScored={false} />);

  const link = getByRole("link");
  expect(link.getAttribute("href")).toBe("/report/r1");
  expect(link.textContent).not.toContain("compare");
});
