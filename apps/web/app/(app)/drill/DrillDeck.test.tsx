import { test, expect, mock, beforeEach } from "bun:test";
import type { ReactNode } from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { DrillCardDTO, DrillQueueResponse, DrillReviewResponse } from "@repo/types";

let review: DrillReviewResponse;

mock.module("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

mock.module("./DrillCard", () => ({
  DrillCard: ({
    card,
    position,
    total,
    maxSeconds,
    onGraded,
  }: {
    card: DrillCardDTO;
    position: number;
    total: number;
    maxSeconds: number;
    maxBytes: number;
    onGraded: (r: DrillReviewResponse) => void;
  }) => (
    <div>
      <p data-testid="question">{card.question}</p>
      <p data-testid="meta">{`${position}/${total} ${card.ahead ? "ahead" : "due"} ${maxSeconds}s`}</p>
      <button type="button" onClick={() => onGraded(review)}>
        Grade it
      </button>
    </div>
  ),
}));

const { DrillDeck } = await import("./DrillDeck");

function card(over: Partial<DrillCardDTO> = {}): DrillCardDTO {
  return {
    id: "c1",
    question: "Why did that index never get used?",
    question_type: "technical",
    due_at: "2026-08-20T09:00:00.000Z",
    interval_days: 1,
    repetitions: 0,
    last_grade: null,
    best_transcript: null,
    best_mean: null,
    ahead: false,
    ...over,
  };
}

let refill: DrillQueueResponse;
const seen: string[] = [];

const fetchMock = mock(async (input: RequestInfo | URL) => {
  const url = String(input);
  seen.push(url);
  if (url.startsWith("/api/drill")) {
    return new Response(JSON.stringify(refill), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("/api/profile")) return new Response("{}", { status: 200 });
  throw new Error(`unexpected fetch: ${url}`);
});

beforeEach(() => {
  fetchMock.mockClear();
  seen.length = 0;
  review = { due_at: "2026-08-27T09:00:00.000Z", interval_days: 1, streak_days: 4 };
  refill = { cards: [], due_total: 0, streak_days: 0, reviewed_today: 0 };
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function mount(initial: Partial<DrillQueueResponse> = {}, needsTimezone = false) {
  return render(
    <DrillDeck
      initial={{ cards: [], due_total: 0, streak_days: 0, reviewed_today: 0, ...initial }}
      needsTimezone={needsTimezone}
      maxSeconds={75}
      maxBytes={5_000_000}
    />,
  );
}

function stat(view: ReturnType<typeof render>, label: string): string {
  return view.getByText(label).nextElementSibling?.firstChild?.textContent ?? "";
}

function grade(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByText("Grade it"));
}

test("grading a due card takes one off the count and takes the streak from the server", async () => {
  const view = mount({ cards: [card()], due_total: 3, streak_days: 3, reviewed_today: 1 });
  expect(stat(view, "Due now")).toBe("3");
  expect(stat(view, "Streak")).toBe("3");

  grade(view);

  await waitFor(() => expect(stat(view, "Streak")).toBe("4"));
  expect(stat(view, "Due now")).toBe("2");
  expect(stat(view, "Done today")).toBe("2");
});

test("a card pulled forward was never due, so grading it leaves the count alone", async () => {
  const view = mount({ cards: [card({ id: "ahead", ahead: true })], due_total: 0, streak_days: 4 });
  expect(view.getByTestId("meta").textContent).toContain("ahead");

  grade(view);

  await waitFor(() => expect(stat(view, "Done today")).toBe("1"));
  expect(stat(view, "Due now")).toBe("0");
});

test("a due count that is already spent cannot go negative", async () => {
  const view = mount({ cards: [card()], due_total: 0 });

  grade(view);

  await waitFor(() => expect(stat(view, "Done today")).toBe("1"));
  expect(stat(view, "Due now")).toBe("0");
});

test("a streak that has not started reads as a dash rather than a zero", () => {
  const view = mount({ cards: [card()], due_total: 1, streak_days: 0 });
  expect(stat(view, "Streak")).toBe("—");
});

test("the deck walks to the next card and stops at the end", async () => {
  const view = mount({
    cards: [card(), card({ id: "c2", question: "How would you shard that table?" })],
    due_total: 2,
  });
  expect(view.getByTestId("meta").textContent).toBe("1/2 due 75s");
  expect(view.container.textContent).toContain("1 more after this one");

  grade(view);
  await waitFor(() => expect(view.getByTestId("question").textContent).toContain("shard"));
  expect(view.getByTestId("meta").textContent).toBe("2/2 due 75s");

  grade(view);
  await waitFor(() => expect(view.container.textContent).toContain("Deck clear"));
  expect(stat(view, "Due now")).toBe("0");
  expect(view.container.textContent).toContain("2 answers");
});

test("an empty deck says so instead of celebrating a drill nobody did", () => {
  const view = mount();
  expect(view.container.textContent).toContain("Nothing is due yet");
  expect(view.container.textContent).not.toContain("Deck clear");
});

test("drill more asks for cards the deck has not shown, and re-syncs the counters", async () => {
  const view = mount({ cards: [card(), card({ id: "c2" })], due_total: 2 });
  grade(view);
  grade(view);
  await waitFor(() => view.getByText("Drill more"));

  refill = {
    cards: [card({ id: "c9", question: "What broke in that deploy?", ahead: true })],
    due_total: 0,
    streak_days: 4,
    reviewed_today: 2,
  };
  fireEvent.click(view.getByText("Drill more"));

  await waitFor(() => expect(view.getByTestId("question").textContent).toContain("that deploy"));
  const asked = decodeURIComponent(seen.find((u) => u.startsWith("/api/drill")) ?? "");
  expect(asked).toContain("exclude=c1,c2");
  expect(view.getByTestId("meta").textContent).toBe("3/3 ahead 75s");
});

test("an empty refill admits the deck is empty instead of offering again", async () => {
  const view = mount();

  fireEvent.click(view.getByText("Drill more"));

  await waitFor(() => expect(view.container.textContent).toContain("Nothing left in the deck"));
  expect(view.queryByText("Drill more")).toBeNull();
});

test("a refill that fails says so and leaves the button", async () => {
  const view = mount();
  fetchMock.mockImplementationOnce(async () =>
    Response.json(
      { error: { code: "rate_limited", message: "Slow down a moment." } },
      { status: 429 },
    ),
  );

  fireEvent.click(view.getByText("Drill more"));

  await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Slow down a moment."));
  expect(view.queryByText("Drill more")).not.toBeNull();
});

test("an account with no timezone reports the browser's, once, and only when asked to", async () => {
  const view = mount({}, true);
  await waitFor(() => expect(seen.filter((u) => u === "/api/profile")).toHaveLength(1));

  view.rerender(
    <DrillDeck
      initial={{ cards: [], due_total: 0, streak_days: 0, reviewed_today: 0 }}
      needsTimezone
      maxSeconds={75}
      maxBytes={5_000_000}
    />,
  );
  expect(seen.filter((u) => u === "/api/profile")).toHaveLength(1);

  mount();
  expect(seen.filter((u) => u === "/api/profile")).toHaveLength(1);
});
