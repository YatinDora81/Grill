import { test, expect, mock, beforeEach } from "bun:test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecorder } from "./useRecorder";

const CHUNK = new Blob(["audio-bytes"], { type: "audio/webm" });

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

function gatedMedia() {
  const tracks: Array<{ stop: ReturnType<typeof mock> }> = [];
  const gates: Array<() => void> = [];
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: mock(async () => {
        const track = { stop: mock(() => {}) };
        tracks.push(track);
        await new Promise<void>((resolve) => gates.push(resolve));
        return { getTracks: () => [track] } as unknown as MediaStream;
      }),
    },
  });
  return {
    tracks,
    releaseAll: () => {
      for (const open of gates.splice(0)) open();
    },
    live: () => tracks.filter((t) => t.stop.mock.calls.length === 0),
  };
}

beforeEach(() => {
  installMediaStubs();
});

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

  await advanceSeconds(2);
  await waitFor(() => expect(result.current.state).toBe("stopped"));

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

test("the stream is handed out only while a take is live", async () => {
  const { result } = renderHook(() => useRecorder(60));
  expect(result.current.stream).toBeNull();

  await act(async () => {
    await result.current.start();
  });
  expect(result.current.stream).not.toBeNull();

  await act(async () => {
    result.current.reset();
  });
  expect(result.current.stream).toBeNull();
});

test("the mic is released when the cap stops the recording", async () => {
  const track = installMediaStubs();
  const { result } = renderHook(() => useRecorder(2));
  await act(async () => {
    await result.current.start();
  });
  await advanceSeconds(2);
  await waitFor(() => expect(result.current.state).toBe("stopped"));
  expect(track.stop).toHaveBeenCalled();
});

test("a microphone that arrives after unmount is stopped, never installed", async () => {
  const media = gatedMedia();
  const { result, unmount } = renderHook(() => useRecorder(60));

  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
  });
  expect(result.current.state).toBe("requesting");

  unmount();
  await act(async () => {
    media.releaseAll();
    await pending;
  });

  expect(media.tracks).toHaveLength(1);
  expect(media.live()).toHaveLength(0);
  expect(result.current.state).toBe("requesting");
});

test("a microphone that arrives after reset() is stopped, never installed", async () => {
  const media = gatedMedia();
  const { result } = renderHook(() => useRecorder(60));

  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
  });
  await act(async () => {
    result.current.reset();
  });
  await act(async () => {
    media.releaseAll();
    await pending;
  });

  expect(media.live()).toHaveLength(0);
  expect(result.current.state).toBe("idle");
});

test("two overlapping start() calls leave exactly one live microphone", async () => {
  const media = gatedMedia();
  const { result } = renderHook(() => useRecorder(60));

  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = result.current.start();
  });
  await act(async () => {
    second = result.current.start();
  });
  expect(media.tracks).toHaveLength(2);

  await act(async () => {
    media.releaseAll();
    await Promise.all([first, second]);
  });

  await waitFor(() => expect(result.current.state).toBe("recording"));
  expect(media.live()).toHaveLength(1);

  await act(async () => {
    result.current.reset();
  });
  expect(media.live()).toHaveLength(0);
});
