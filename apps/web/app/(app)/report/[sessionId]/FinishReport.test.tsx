import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { SessionStatus } from "@repo/types";

/**
 * This screen is all that stands between a finished interview and the report,
 * and in its normal state it has no button — it waits on a timer. So what's
 * worth testing isn't what it renders, it's whether the loop is still alive: a
 * poll that has quietly stopped looks exactly like one that is still working.
 *
 * Note: queries come from `render()`, never from `screen`. test/setup.ts imports
 * @testing-library/react before it registers happy-dom, so `screen` binds to a
 * document that doesn't exist yet and throws on every query.
 */

const refresh = mock(() => {});
/**
 * One object for every render, like the real `useRouter`. The poll effect lists
 * `router` in its deps — a fresh object per render would rebuild the loop by
 * accident on every state change, hiding the dead-loop bug these tests exist to
 * catch.
 */
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

/**
 * Matches POLL_MS (2.5s) with room for a second poll to land. These wait in real
 * time: the loop is `setTimeout` inside an effect, and faking the clock out from
 * under React's scheduler costs more than it buys here.
 */
const TWO_POLLS = 6_000;
/** Bun's per-test default is 5s — under a 2.5s poll, two waits blow through it. */
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

  // Stub the network rather than apiClient: the request counts below are the
  // assertion, and a mocked apiGet would only be counting my own stub.
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
    // The server's reason, not a generic string — it's what tells someone
    // whether retrying is worth their time.
    expect(getByText("The scorer ran out of tokens.")).toBeDefined();

    // Mount always re-kicks the build. On Hobby, where cron runs once a day,
    // opening this page is the only thing that restarts a killed build.
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

    // The whole point of the fix. The loop stops by returning instead of
    // rescheduling, so resetting `error` alone puts the spinner back with
    // nothing behind it — a screen that waits forever on a poll that is never
    // coming. Only a fresh status request proves the loop was really rebuilt.
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

    // This screen never renders the report itself — the server component above
    // it does, and only a refresh swaps this one out. Lose the refresh and a
    // finished report sits behind a spinner.
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: TWO_POLLS });
  },
  BUDGET,
);
