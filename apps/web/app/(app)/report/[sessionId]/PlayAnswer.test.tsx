import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import type { PlayAnswerHandle } from "./PlayAnswer";

class FakeAudio {
  static instances: FakeAudio[] = [];
  readonly src: string;
  paused = true;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  async play() {
    this.playCalls++;
    this.paused = false;
  }

  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
}

let presignHits: number;
let presignFails: boolean;
let releasePresign: () => void;

beforeEach(() => {
  FakeAudio.instances = [];
  presignHits = 0;
  presignFails = false;
  const gate = new Promise<void>((resolve) => {
    releasePresign = resolve;
  });
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/interview/audio/presign")) {
      presignHits++;
      const n = presignHits;
      await gate;
      if (presignFails) {
        return new Response(
          JSON.stringify({ error: { code: "gone", message: "Recording expired." } }),
          { status: 410, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ url: `https://r2.example/a-${n}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

const { PlayAnswer } = await import("./PlayAnswer");

function mount() {
  const seekRef: RefObject<PlayAnswerHandle | null> = { current: null };
  const view = render(<PlayAnswer sessionId="s1" turnIndex={0} seekRef={seekRef} />);
  return { ...view, seekRef };
}

test("word clicks while the presign is in flight mint one URL and one Audio", async () => {
  const { getByLabelText, seekRef } = mount();

  act(() => {
    seekRef.current?.seekTo(5);
  });
  expect(getByLabelText("Play your answer").textContent).toContain("loading…");

  act(() => {
    seekRef.current?.seekTo(9);
  });
  act(() => {
    seekRef.current?.seekTo(12);
  });
  fireEvent.click(getByLabelText("Play your answer"));

  releasePresign();
  await waitFor(() => expect(getByLabelText("Pause your answer")).toBeDefined());

  expect(presignHits).toBe(1);
  expect(FakeAudio.instances.length).toBe(1);
  expect(FakeAudio.instances[0]!.playCalls).toBe(1);
  expect(FakeAudio.instances[0]!.currentTime).toBe(12);
});

test("no Audio is orphaned by clicks during the load — pausing stops every one of them", async () => {
  const { getByLabelText, seekRef } = mount();

  act(() => {
    seekRef.current?.seekTo(5);
  });
  act(() => {
    seekRef.current?.seekTo(9);
  });

  releasePresign();
  await waitFor(() => expect(getByLabelText("Pause your answer")).toBeDefined());

  fireEvent.click(getByLabelText("Pause your answer"));

  expect(FakeAudio.instances.every((a) => a.paused)).toBe(true);
});

test("unmounting during playback leaves nothing playing", async () => {
  const { getByLabelText, seekRef, unmount } = mount();

  act(() => {
    seekRef.current?.seekTo(3);
  });
  act(() => {
    seekRef.current?.seekTo(4);
  });

  releasePresign();
  await waitFor(() => expect(getByLabelText("Pause your answer")).toBeDefined());

  unmount();

  expect(FakeAudio.instances.every((a) => a.paused)).toBe(true);
});

test("once loaded, a word click seeks the element already in hand", async () => {
  const { getByLabelText, seekRef } = mount();

  fireEvent.click(getByLabelText("Play your answer"));
  releasePresign();
  await waitFor(() => expect(getByLabelText("Pause your answer")).toBeDefined());

  act(() => {
    seekRef.current?.seekTo(7);
  });

  expect(presignHits).toBe(1);
  expect(FakeAudio.instances.length).toBe(1);
  expect(FakeAudio.instances[0]!.currentTime).toBe(7);
});

test("a presign failure reports itself instead of leaving a silent loading button", async () => {
  presignFails = true;
  const { findByText, seekRef } = mount();

  act(() => {
    seekRef.current?.seekTo(2);
  });
  releasePresign();

  expect((await findByText("audio unavailable")).textContent).toBe("audio unavailable");
  expect(FakeAudio.instances.length).toBe(0);
});
