import { expect, mock, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { LiveTokenResponse } from "@repo/types";
import type { LiveMessage } from "@/lib/live/pairing";
import type { GeminiLive } from "./useGeminiLive";

const TOKEN: LiveTokenResponse = {
  token: "auth_tokens/ephemeral",
  model: "models/live",
  expires_at: new Date().toISOString(),
  opener: "Why did the ledger drift?",
  max_minutes: 12,
};

const apiPost = mock(async () => TOKEN);
mock.module("@/lib/apiClient", () => ({
  apiPost,
  ApiClientError: class ApiClientError extends Error {},
}));

interface Callbacks {
  onopen?: () => void;
  onmessage?: (m: LiveMessage) => void;
  onerror?: (e: { message: string }) => void;
  onclose?: () => void;
}

let callbacks: Callbacks | null = null;
const connect = mock(async ({ callbacks: cb }: { callbacks: Callbacks }) => {
  callbacks = cb;
  cb.onopen?.();
  return { sendClientContent: () => {}, sendRealtimeInput: () => {}, close: () => {} };
});

mock.module("@google/genai", () => ({
  GoogleGenAI: class {
    live = { connect };
    constructor(_options: unknown) {}
  },
  Modality: { AUDIO: "AUDIO" },
}));

const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = "suspended";
  currentTime = 0;
  sampleRate: number;
  resumes = 0;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 44_100;
    contexts.push(this);
  }
  resume = async () => {
    this.state = "running";
    this.resumes += 1;
  };
  close = async () => {
    this.state = "closed";
  };
  createMediaStreamSource = () => ({ connect: () => {} });
  createGain = () => ({ gain: { value: 1 }, connect: () => {} });
}

class FakeAudioWorkletNode {
  port = { onmessage: null as unknown, close: () => {} };
  constructor(_ctx: unknown, _name: string) {}
  connect = () => {};
  disconnect = () => {};
}

function installAudioStubs() {
  contexts.length = 0;
  callbacks = null;
  apiPost.mockClear();
  connect.mockClear();
  (globalThis as any).AudioContext = FakeAudioContext;
  (globalThis as any).AudioWorkletNode = FakeAudioWorkletNode;
  const track = { stop: mock(() => {}) };
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mock(async () => ({ getTracks: () => [track] })) },
  });
  return track;
}

const { useGeminiLive } = await import("./useGeminiLive");

let handle: GeminiLive | null = null;

function Harness() {
  handle = useGeminiLive("11111111-1111-4111-8111-111111111111", 12);
  return <span data-testid="state">{handle.state}</span>;
}

test("the hook sits idle until it is started, and ending before that is harmless", async () => {
  const { getByTestId } = render(<Harness />);

  expect(getByTestId("state").textContent).toBe("idle");
  expect(handle?.log).toEqual([]);
  expect(handle?.elapsedS).toBe(0);
  let pairs: unknown;
  await act(async () => {
    pairs = await handle!.end();
  });
  expect(pairs).toEqual([]);
});

test("a capture context the browser handed over suspended is resumed before it is wired up", async () => {
  installAudioStubs();
  render(<Harness />);

  await act(async () => {
    await handle!.start();
  });

  const capture = contexts[0]!;
  expect(capture.sampleRate).toBe(16_000);
  expect(capture.resumes).toBe(1);
  expect(capture.state).toBe("running");
  expect(handle?.state).toBe("live");

  await act(async () => {
    await handle!.end();
  });
});

test("a socket that dies mid-session can be started again", async () => {
  installAudioStubs();
  render(<Harness />);

  await act(async () => {
    await handle!.start();
  });
  expect(connect).toHaveBeenCalledTimes(1);

  await act(async () => {
    callbacks!.onerror?.({ message: "the live line dropped" });
  });
  expect(handle?.state).toBe("failed");
  expect(handle?.error).toBe("the live line dropped");

  await act(async () => {
    await handle!.start();
  });

  expect(apiPost).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(handle?.state).toBe("live");

  await act(async () => {
    await handle!.end();
  });
});
