import { test, expect, mock, beforeEach } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecorder } from "./useRecorder";

/**
 * The recorder enforces the answer time cap itself, which is the whole reason
 * these exist: it stops on its own schedule, with no user gesture behind it, and
 * everything that delivers the take has to already be in place when it does.
 */

const CHUNK = new Blob(["audio-bytes"], { type: "audio/webm" });

/** A MediaRecorder that records nothing and obeys start/stop, so the cap can drive it. */
class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, _o?: unknown) {}
  start() {
    this.state = "recording";
  }
  requestData() {
    this.ondataavailable?.({ data: CHUNK });
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: CHUNK });
    this.onstop?.();
  }
}

function installMediaStubs() {
  const track = { stop: mock(() => {}) };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mock(async () => stream) },
  });
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  // The level meter is decoration here; give it just enough not to throw.
  (globalThis as any).AudioContext = class {
    state = "running";
    createAnalyser = () => ({ fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData: () => {} });
    createMediaStreamSource = () => ({ connect: () => {} });
    close = async () => {};
    resume = async () => {};
  };
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
  return track;
}

beforeEach(() => {
  installMediaStubs();
});

/** Drive the recorder's 1s tick without waiting in real time. */
async function advanceSeconds(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
  }
}

test("the take survives the cap: stop() returns the recording, not null", async () => {
  const { result } = renderHook(() => useRecorder(2));
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.state).toBe("recording");

  // Nobody calls stop(); the cap does it from inside the tick.
  await advanceSeconds(2);
  await waitFor(() => expect(result.current.state).toBe("stopped"));

  // This is the original bug: the blob existed but was resolved into a promise
  // nobody held, so stop() handed back null and the answer vanished.
  const blob = await act(async () => result.current.stop());
  expect(blob).not.toBeNull();
  expect(blob!.size).toBeGreaterThan(0);
});

test("the cap names itself, so a consumer can tell it from a manual stop", async () => {
  const { result } = renderHook(() => useRecorder(2));
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.capped).toBe(false);

  await advanceSeconds(2);
  await waitFor(() => expect(result.current.capped).toBe(true));
});

test("a manual stop is NOT reported as capped", async () => {
  const { result } = renderHook(() => useRecorder(60));
  await act(async () => {
    await result.current.start();
  });
  const blob = await act(async () => result.current.stop());
  expect(blob).not.toBeNull();
  // `capped` is what HotSeat keys its auto-submit on. If a manual stop set it,
  // every ordinary answer would be submitted twice.
  expect(result.current.capped).toBe(false);
});

test("start() and reset() clear capped, so the next take is not auto-submitted", async () => {
  const { result } = renderHook(() => useRecorder(2));
  await act(async () => {
    await result.current.start();
  });
  await advanceSeconds(2);
  await waitFor(() => expect(result.current.capped).toBe(true));

  await act(async () => {
    result.current.reset();
  });
  expect(result.current.capped).toBe(false);
  expect(result.current.state).toBe("idle");
});

test("reset() drops the take so a consumed one is never handed out twice", async () => {
  const { result } = renderHook(() => useRecorder(60));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    result.current.reset();
  });
  const blob = await act(async () => result.current.stop());
  expect(blob).toBeNull();
});

test("the mic is released when the cap stops the recording", async () => {
  const track = installMediaStubs();
  const { result } = renderHook(() => useRecorder(2));
  await act(async () => {
    await result.current.start();
  });
  await advanceSeconds(2);
  await waitFor(() => expect(result.current.state).toBe("stopped"));
  // A hot mic left open past the answer is a privacy problem, not a leak of tidiness.
  expect(track.stop).toHaveBeenCalled();
});
