import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * The offset is the whole feature: "Watch" on a turn is meant to drop you at the
 * moment that answer started, not at the top of the recording. Everything here
 * is about whether the seek actually happens, on every open.
 *
 * happy-dom has no playback engine, so the <video> is driven by hand: the
 * element's own accessors are replaced to record seeks, and the media events a
 * real browser would fire (loadedmetadata, timeupdate) are fired here instead.
 *
 * Queries come from `render()`, never `screen`: test/setup.ts imports
 * @testing-library/react before registering happy-dom, so `screen` is bound to a
 * document that doesn't exist yet and throws on every query.
 */

const OFFSET_MS = 45_000;
const PRESIGNED = "https://r2.example/vid-1?sig=abc";

/**
 * Every write to `currentTime`, in order. A MediaRecorder webm has no Duration
 * element, so a correct seek is two writes: one past any real end to force the
 * browser to scan, then the offset we actually wanted.
 */
let seeks: number[];
/** What the element reports. NaN is what you get before the scan — the real case. */
let duration: number;
let presignHits: number;

function installVideoStubs() {
  seeks = [];
  duration = NaN;
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => seeks[seeks.length - 1] ?? 0,
    set: (v: number) => {
      seeks.push(v);
    },
  });
}

beforeEach(() => {
  installVideoStubs();
  presignHits = 0;
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/interview/video/presign")) {
      presignHits++;
      return new Response(JSON.stringify({ url: PRESIGNED }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

const { WatchAnswer } = await import("./WatchAnswer");

/** The browser scanning to the real end and reporting a duration at last. */
function scanCompletes(video: HTMLVideoElement, realDuration: number) {
  duration = realDuration;
  fireEvent.timeUpdate(video);
}

test("the first open seeks past the end to learn the duration, then lands on the offset", async () => {
  const { container, getByRole } = render(<WatchAnswer videoId="vid-1" offsetMs={OFFSET_MS} />);

  fireEvent.click(getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const video = container.querySelector("video") as HTMLVideoElement;
  expect(video.getAttribute("src")).toBe(PRESIGNED);

  fireEvent.loadedMetadata(video);
  // Only the forcing hop so far: duration is still unknown, so seeking to the
  // offset now would be ignored and the answer would play from the top.
  expect(seeks).toEqual([1e101]);

  scanCompletes(video, 120);
  expect(seeks[seeks.length - 1]).toBe(45);
});

test("reopening seeks again instead of replaying from 0:00", async () => {
  const { container, getByRole } = render(<WatchAnswer videoId="vid-1" offsetMs={OFFSET_MS} />);

  fireEvent.click(getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const first = container.querySelector("video") as HTMLVideoElement;
  fireEvent.loadedMetadata(first);
  scanCompletes(first, 120);
  expect(seeks).toEqual([1e101, 45]);

  fireEvent.click(getByRole("button", { name: "Hide" }));
  await waitFor(() => expect(container.querySelector("video")).toBeNull());

  // A fresh element knows nothing: no duration, sitting at 0:00.
  seeks = [];
  duration = NaN;

  fireEvent.click(getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const second = container.querySelector("video") as HTMLVideoElement;
  expect(second).not.toBe(first);

  fireEvent.loadedMetadata(second);
  scanCompletes(second, 120);

  // The regression. `seeked` used to latch true on the first open and never
  // clear, so every reopen short-circuited the seek and quietly played the
  // whole recording from the top — the offset silently stopped meaning anything.
  expect(seeks).toEqual([1e101, 45]);
});

test("the presigned URL is minted once and reused, not per open", async () => {
  const { container, getByRole } = render(<WatchAnswer videoId="vid-1" offsetMs={OFFSET_MS} />);

  fireEvent.click(getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  fireEvent.click(getByRole("button", { name: "Hide" }));
  await waitFor(() => expect(container.querySelector("video")).toBeNull());
  fireEvent.click(getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());

  // A 40-turn report that re-presigned on every toggle is exactly the load this
  // component exists to avoid.
  expect(presignHits).toBe(1);
});
