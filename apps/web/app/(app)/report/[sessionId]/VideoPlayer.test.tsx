import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * The offset is the whole feature: the tape on a turn is meant to drop you at
 * the moment that answer started, not at the top of the recording. Everything
 * here is about whether the seek actually happens, and whether one mount costs
 * exactly one presigned URL.
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
const PLAY_LABEL = "Play your answer to question 4";

/**
 * Every write to `currentTime`, in order. A MediaRecorder webm has no Duration
 * element, so a correct seek is two writes: one past any real end to force the
 * browser to scan, then the offset we actually wanted.
 */
let seeks: number[];
/** What the element reports. NaN is what you get before the scan — the real case. */
let duration: number;
let presignHits: number;
let presignFails: boolean;

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
  // The component calls play() once the seek lands; happy-dom has no engine.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
}

beforeEach(() => {
  installVideoStubs();
  presignHits = 0;
  presignFails = false;
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/interview/video/presign")) {
      presignHits++;
      if (presignFails) {
        return new Response(
          JSON.stringify({ error: { code: "gone", message: "Recording expired." } }),
          { status: 410, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ url: PRESIGNED }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

const { VideoPlayer } = await import("./VideoPlayer");

function mount() {
  return render(
    <VideoPlayer videoId="vid-1" offsetMs={OFFSET_MS} turnNumber={4} expiresInDays={13} />,
  );
}

/** The browser scanning to the real end and reporting a duration at last. */
function scanCompletes(video: HTMLVideoElement, realDuration: number) {
  duration = realDuration;
  fireEvent.timeUpdate(video);
}

test("pressing play seeks past the end to learn the duration, then lands on the offset", async () => {
  const { container, getByLabelText } = mount();

  fireEvent.click(getByLabelText(PLAY_LABEL));
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

test("a fresh mount seeks again instead of replaying from 0:00", async () => {
  const first = mount();
  fireEvent.click(first.getByLabelText(PLAY_LABEL));
  await waitFor(() => expect(first.container.querySelector("video")).not.toBeNull());
  const a = first.container.querySelector("video") as HTMLVideoElement;
  fireEvent.loadedMetadata(a);
  scanCompletes(a, 120);
  expect(seeks).toEqual([1e101, 45]);

  // Collapsing the turn unmounts the player; reopening it mounts a new one that
  // knows nothing — no duration, sitting at 0:00.
  first.unmount();
  seeks = [];
  duration = NaN;

  const second = mount();
  fireEvent.click(second.getByLabelText(PLAY_LABEL));
  await waitFor(() => expect(second.container.querySelector("video")).not.toBeNull());
  const b = second.container.querySelector("video") as HTMLVideoElement;
  expect(b).not.toBe(a);

  fireEvent.loadedMetadata(b);
  scanCompletes(b, 120);
  expect(seeks).toEqual([1e101, 45]);
});

test("the presigned URL is minted once per mount, not per press", async () => {
  const { container, getByLabelText } = mount();

  fireEvent.click(getByLabelText(PLAY_LABEL));
  await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
  const video = container.querySelector("video") as HTMLVideoElement;
  fireEvent.loadedMetadata(video);
  scanCompletes(video, 120);

  // Play → pause → play again. A 40-turn report that re-presigned on every
  // press is exactly the load this component exists to avoid.
  fireEvent.play(video);
  fireEvent.click(getByLabelText("Pause"));
  fireEvent.pause(video);
  fireEvent.click(getByLabelText(PLAY_LABEL));

  expect(presignHits).toBe(1);
});

test("a presign failure says so instead of showing a dead play button", async () => {
  presignFails = true;
  const { container, getByLabelText, findByRole } = mount();

  fireEvent.click(getByLabelText(PLAY_LABEL));

  const alert = await findByRole("alert");
  expect(alert.textContent).toContain("Couldn't load the video.");
  expect(container.querySelector("video")).toBeNull();
});
