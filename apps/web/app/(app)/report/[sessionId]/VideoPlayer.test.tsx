import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";

const OFFSET_MS = 45_000;
const PRESIGNED = "https://r2.example/vid-1?sig=abc";
const PLAY_LABEL = "Play your answer to question 4";

let seeks: number[];
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
