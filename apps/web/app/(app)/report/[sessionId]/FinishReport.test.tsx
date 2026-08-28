import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { SessionStatus } from "@repo/types";

const refresh = mock(() => {});
const router = {
  refresh,
  push: mock(() => {}),
  replace: mock(() => {}),
  back: mock(() => {}),
  forward: mock(() => {}),
  prefetch: mock(() => {}),
};
mock.module("next/navigation", () => ({ useRouter: () => router }));

const { FinishReport } = await import("./FinishReport");

const TWO_POLLS = 6_000;
const BUDGET = 20_000;

type StatusBody = {
  session_id: string;
  status: SessionStatus;
  ready: boolean;
  error_reason: string | null;
};

const FAILED_BUILD: StatusBody = {
  session_id: "s1",
  status: "error",
  ready: false,
  error_reason: "The scorer ran out of tokens.",
};
const STILL_BUILDING: StatusBody = {
  session_id: "s1",
  status: "generating_report",
  ready: false,
  error_reason: null,
};

let statusBody: StatusBody;
let statusHits: number;
let endHits: number;

const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  statusHits = 0;
  endHits = 0;
  refresh.mockClear();
  statusBody = STILL_BUILDING;

  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) {
      statusHits++;
      return jsonRes(statusBody);
    }
    if (url.includes("/api/interview/end")) {
      endHits++;
      return jsonRes({ session_id: "s1", status: "ended" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

test(
  "a build that failed for good stops the wait and says so, instead of spinning",
  async () => {
    statusBody = FAILED_BUILD;
    const { getByText } = render(<FinishReport sessionId="s1" />);

    await waitFor(() => expect(getByText("The report didn't build")).toBeDefined(), {
      timeout: TWO_POLLS,
    });
    expect(getByText("The scorer ran out of tokens.")).toBeDefined();

    expect(endHits).toBeGreaterThan(0);
  },
  BUDGET,
);

test(
  "'Try again' resumes polling — it rebuilds the loop, not just the message",
  async () => {
    statusBody = FAILED_BUILD;
    const { getByText, getByRole } = render(<FinishReport sessionId="s1" />);
    await waitFor(() => expect(getByText("The report didn't build")).toBeDefined(), {
      timeout: TWO_POLLS,
    });

    const hitsWhenStopped = statusHits;
    statusBody = STILL_BUILDING;
    fireEvent.click(getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(statusHits).toBeGreaterThan(hitsWhenStopped), {
      timeout: TWO_POLLS,
    });
    expect(getByText("Scoring your interview")).toBeDefined();
  },
  BUDGET,
);

test(
  "a ready report refreshes the page onto it rather than announcing it here",
  async () => {
    statusBody = { session_id: "s1", status: "completed", ready: true, error_reason: null };
    render(<FinishReport sessionId="s1" />);

    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: TWO_POLLS });
  },
  BUDGET,
);
