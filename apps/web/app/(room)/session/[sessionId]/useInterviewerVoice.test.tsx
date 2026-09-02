import { test, expect, mock, beforeEach } from "bun:test";
import { render, act, waitFor } from "@testing-library/react";
import type { VoiceResponse } from "@repo/types";
import type { useSpeech } from "@/hooks/useSpeech";
import type { LocalVoice } from "@/hooks/useKokoro";

const apiPost = mock(async (_path: string, _payload: unknown): Promise<VoiceResponse> => ({
  url: null,
  provider: "browser",
  reason: "disabled",
}));
mock.module("@/lib/apiClient", () => ({ apiPost }));

class FakeAudio {
  static instances: FakeAudio[] = [];
  static blockAutoplay = false;
  src: string;
  playCalls = 0;
  pauseCalls = 0;
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  async play() {
    this.playCalls++;
    if (FakeAudio.blockAutoplay) throw new Error("NotAllowedError");
    this.onplay?.();
  }

  pause() {
    this.pauseCalls++;
  }
}

const { prefetchQuestionAudio, useInterviewerVoice } = await import("./useInterviewerVoice");

const speak = mock((_text: string) => {});
const stopBrowserVoice = mock(() => {});
let muted = false;
let browserSpeaking = false;
let renders = 0;

function fakeSpeech(): ReturnType<typeof useSpeech> {
  renders++;
  return {
    supported: true,
    speaking: browserSpeaking,
    muted,
    voices: [],
    englishVoices: [],
    voiceURI: null,
    currentVoice: undefined,
    speak,
    stop: stopBrowserVoice,
    toggleMute: () => {},
    selectVoice: () => {},
  } as unknown as ReturnType<typeof useSpeech>;
}

let handle: ReturnType<typeof useInterviewerVoice> | null = null;

let localReady = false;
let localSpeaking = false;
let localTakes = true;
const localSpeak = mock(
  (_text: string, _voice: string, _opts?: { speed?: number; onEnd?: () => void }) => localTakes,
);
const localStop = mock(() => {});

function fakeLocal(): LocalVoice {
  return {
    state: localReady ? "ready" : "loading",
    ready: localReady,
    progress: null,
    device: localReady ? "wasm" : null,
    speaking: localSpeaking,
    speak: localSpeak,
    stop: localStop,
  };
}

function Harness({
  turnIndex,
  question,
  local,
}: {
  turnIndex: number;
  question: string;
  local?: boolean;
}) {
  handle = useInterviewerVoice({
    sessionId: "sess_1",
    turnIndex,
    question,
    speech: fakeSpeech(),
    delayMs: 0,
    local: local ? fakeLocal() : null,
    localVoice: "am_michael",
  });
  return <span data-testid="speaking">{String(handle.speaking)}</span>;
}

beforeEach(() => {
  apiPost.mockClear();
  speak.mockClear();
  stopBrowserVoice.mockClear();
  FakeAudio.instances = [];
  FakeAudio.blockAutoplay = false;
  muted = false;
  browserSpeaking = false;
  renders = 0;
  handle = null;
  localReady = false;
  localSpeaking = false;
  localTakes = true;
  localSpeak.mockClear();
  localStop.mockClear();
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
});

const QUESTION = "Tell me about a time you shipped late.";
const LINE = "Let me stop you there. What was the result?";

function browserUtterance(again: () => void) {
  browserSpeaking = true;
  again();
  browserSpeaking = false;
  again();
}

test("reads the question in the browser's voice when there is no clip", async () => {
  render(<Harness turnIndex={0} question={QUESTION} />);

  await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  expect(speak).toHaveBeenCalledWith(QUESTION);
  expect(FakeAudio.instances).toHaveLength(0);
});

test("plays the clip and stays silent in the browser when there is one", async () => {
  apiPost.mockImplementationOnce(async () => ({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: true,
  }));

  const { getByTestId } = render(<Harness turnIndex={0} question={QUESTION} />);

  await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
  expect(FakeAudio.instances[0]?.src).toBe("https://r2.test/clip.wav");
  expect(speak).not.toHaveBeenCalled();
  await waitFor(() => expect(getByTestId("speaking").textContent).toBe("true"));
});

test("falls back to the browser voice when the browser blocks autoplay", async () => {
  FakeAudio.blockAutoplay = true;
  apiPost.mockImplementationOnce(async () => ({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: false,
  }));

  render(<Harness turnIndex={0} question={QUESTION} />);

  await waitFor(() => expect(speak).toHaveBeenCalledWith(QUESTION));
});

test("falls back to the browser voice when the request itself fails", async () => {
  apiPost.mockImplementationOnce(async () => {
    throw new Error("network down");
  });

  render(<Harness turnIndex={0} question={QUESTION} />);

  await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  expect(speak).toHaveBeenCalledWith(QUESTION);
});

test("says nothing at all while muted", async () => {
  muted = true;
  apiPost.mockImplementationOnce(async () => ({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: true,
  }));

  render(<Harness turnIndex={0} question={QUESTION} />);

  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(speak).not.toHaveBeenCalled();
  expect(FakeAudio.instances).toHaveLength(0);
});

test("asks for a question's audio once, however often the room re-renders", async () => {
  const { rerender } = render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));

  rerender(<Harness turnIndex={0} question={QUESTION} />);
  rerender(<Harness turnIndex={0} question={QUESTION} />);

  expect(renders).toBeGreaterThan(2);
  expect(apiPost).toHaveBeenCalledTimes(1);
});

test("asks again, and only again, when the interview moves to the next question", async () => {
  const { rerender } = render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));

  rerender(<Harness turnIndex={1} question="What would you undo?" />);

  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
  expect(apiPost.mock.calls[1]?.[1]).toEqual({ session_id: "sess_1", turn_index: 1 });
});

test("replay uses the clip it already has rather than fetching another", async () => {
  apiPost.mockImplementationOnce(async () => ({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: true,
  }));

  render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

  act(() => handle?.replay());

  await waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
  expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
  expect(apiPost).toHaveBeenCalledTimes(1);
});

test("stop silences both providers", async () => {
  apiPost.mockImplementationOnce(async () => ({
    url: "https://r2.test/clip.wav",
    provider: "orpheus",
    cached: true,
  }));

  const { getByTestId } = render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(getByTestId("speaking").textContent).toBe("true"));

  act(() => handle?.stop());

  expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
  expect(stopBrowserVoice).toHaveBeenCalled();
  expect(getByTestId("speaking").textContent).toBe("false");
});

test("a line the interviewer cuts in with is not the end of a question", async () => {
  const { rerender } = render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(speak).toHaveBeenCalledWith(QUESTION));
  const again = () => rerender(<Harness turnIndex={0} question={QUESTION} />);

  act(() => handle?.interject(LINE));
  expect(speak).toHaveBeenCalledWith(LINE);

  browserUtterance(again);
  expect(handle?.endedAt).toBeNull();

  browserUtterance(again);
  expect(handle?.endedAt).not.toBeNull();
});

test("an interjection nobody hears does not swallow the next question's ending", async () => {
  const { rerender } = render(<Harness turnIndex={0} question={QUESTION} />);
  await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  const again = () => rerender(<Harness turnIndex={0} question={QUESTION} />);

  act(() => handle?.interject(""));
  muted = true;
  again();
  act(() => handle?.interject(LINE));
  expect(speak).toHaveBeenCalledTimes(1);

  browserUtterance(again);
  expect(handle?.endedAt).not.toBeNull();
});

test("prefetching warms the cache without demanding anything back", async () => {
  apiPost.mockImplementationOnce(async () => {
    throw new Error("network down");
  });

  expect(() => prefetchQuestionAudio("sess_1", 3)).not.toThrow();
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(apiPost.mock.calls[0]?.[1]).toEqual({ session_id: "sess_1", turn_index: 3 });
});

test("a pre-fetch and the hook share one request instead of both paying for it", async () => {
  let release: (value: VoiceResponse) => void = () => {};
  apiPost.mockImplementationOnce(
    () => new Promise<VoiceResponse>((resolve) => { release = resolve; }),
  );

  prefetchQuestionAudio("sess_1", 4);
  render(<Harness turnIndex={4} question={QUESTION} />);

  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));

  await act(async () => {
    release({ url: null, provider: "browser", reason: "budget" });
  });

  await waitFor(() => expect(speak).toHaveBeenCalledWith(QUESTION));
  expect(apiPost).toHaveBeenCalledTimes(1);
});

test("lets the on-device voice read the question and never spends a server clip", async () => {
  localReady = true;

  render(<Harness turnIndex={0} question={QUESTION} local />);

  await waitFor(() => expect(localSpeak).toHaveBeenCalledTimes(1));
  expect(localSpeak.mock.calls[0]?.[0]).toBe(QUESTION);
  expect(localSpeak.mock.calls[0]?.[1]).toBe("am_michael");
  expect(apiPost).not.toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
});

test("the on-device voice finishing is what starts the answer clock", async () => {
  localReady = true;

  render(<Harness turnIndex={0} question={QUESTION} local />);
  await waitFor(() => expect(localSpeak).toHaveBeenCalledTimes(1));
  expect(handle?.endedAt).toBeNull();

  act(() => localSpeak.mock.calls[0]?.[2]?.onEnd?.());

  expect(handle?.endedAt).not.toBeNull();
});

test("stop silences the on-device voice as well", async () => {
  localReady = true;

  render(<Harness turnIndex={0} question={QUESTION} local />);
  await waitFor(() => expect(localSpeak).toHaveBeenCalledTimes(1));

  act(() => handle?.stop());

  expect(localStop).toHaveBeenCalled();
});

test("counts the on-device voice as the interviewer speaking", async () => {
  localReady = true;
  localSpeaking = true;

  const { getByTestId } = render(<Harness turnIndex={0} question={QUESTION} local />);

  await waitFor(() => expect(getByTestId("speaking").textContent).toBe("true"));
});

test("asks the server for a clip while the model is still downloading", async () => {
  render(<Harness turnIndex={0} question={QUESTION} local />);

  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(localSpeak).not.toHaveBeenCalled();
  expect(speak).toHaveBeenCalledWith(QUESTION);
});

test("sends a question kokoro cannot read back to the server lane", async () => {
  localReady = true;
  const hindi = "आपने वह सिस्टम कैसे बनाया?";

  render(<Harness turnIndex={0} question={hindi} local />);

  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(localSpeak).not.toHaveBeenCalled();
});

test("falls through to the browser when the on-device voice refuses the line", async () => {
  localReady = true;
  localTakes = false;

  render(<Harness turnIndex={0} question={QUESTION} local />);

  await waitFor(() => expect(speak).toHaveBeenCalledWith(QUESTION));
  expect(localSpeak).toHaveBeenCalledTimes(1);
});
