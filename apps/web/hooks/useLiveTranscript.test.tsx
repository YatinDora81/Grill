import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, act } from "@testing-library/react";
import { MAX_RESTARTS, useLiveTranscript } from "./useLiveTranscript";

interface FakeAlternative {
  transcript: string;
}

interface FakeEvent {
  results: { isFinal: boolean; 0: FakeAlternative }[];
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static failNextStart = false;

  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onresult: ((event: FakeEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.startCalls++;
    if (FakeRecognition.failNextStart) {
      FakeRecognition.failNextStart = false;
      throw new Error("InvalidStateError");
    }
  }

  stop() {
    this.stopCalls++;
    this.onend?.();
  }

  abort() {
    this.abortCalls++;
    this.onend?.();
  }
}

function current(): FakeRecognition {
  const recognition = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  if (!recognition) throw new Error("no recogniser was constructed");
  return recognition;
}

function results(...parts: [string, boolean][]): FakeEvent {
  return {
    results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
  };
}

function speak(...parts: [string, boolean][]) {
  act(() => {
    current().onresult?.(results(...parts));
  });
}

function endSession() {
  act(() => {
    current().onend?.();
  });
}

type MutableWindow = Record<string, unknown>;

function installRecognition(key: "SpeechRecognition" | "webkitSpeechRecognition") {
  (window as unknown as MutableWindow)[key] = FakeRecognition;
}

function Harness({ active }: { active: boolean }) {
  const live = useLiveTranscript(active);
  return (
    <>
      <span data-testid="supported">{String(live.supported)}</span>
      <span data-testid="words">{live.words}</span>
      <span data-testid="fillers">{live.fillers}</span>
      <span data-testid="restarts">{live.restartCount}</span>
    </>
  );
}

const warn = console.warn;

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.failNextStart = false;
  delete (window as unknown as MutableWindow).SpeechRecognition;
  delete (window as unknown as MutableWindow).webkitSpeechRecognition;
});

afterEach(() => {
  console.warn = warn;
});

test("starts a recogniser for the take and reports the browser as supported", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);

  expect(getByTestId("supported").textContent).toBe("true");
  expect(FakeRecognition.instances).toHaveLength(1);
  expect(current().startCalls).toBe(1);
  expect(current().continuous).toBe(true);
  expect(current().interimResults).toBe(true);
  expect(current().lang.startsWith("en")).toBe(true);
});

test("counts words and fillers off interim results, using the report's own list", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);
  speak(["so um I rebuilt the pipeline", false]);

  expect(getByTestId("words").textContent).toBe("6");
  expect(getByTestId("fillers").textContent).toBe("1");
});

test("a new take starts from nothing rather than the previous answer's numbers", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId, rerender } = render(<Harness active={true} />);
  speak(["we cut the p99 in half", true]);
  endSession();
  expect(getByTestId("words").textContent).toBe("6");
  expect(getByTestId("restarts").textContent).toBe("1");

  rerender(<Harness active={false} />);
  expect(getByTestId("words").textContent).toBe("0");
  expect(getByTestId("fillers").textContent).toBe("0");
  expect(getByTestId("restarts").textContent).toBe("0");

  rerender(<Harness active={true} />);
  expect(FakeRecognition.instances).toHaveLength(2);
  expect(getByTestId("words").textContent).toBe("0");
  expect(current().startCalls).toBe(1);
});

test("restarts the recogniser when a session ends mid-take", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);
  endSession();

  expect(current().startCalls).toBe(2);
  expect(FakeRecognition.instances).toHaveLength(1);
  expect(getByTestId("restarts").textContent).toBe("1");
});

test("carries finalised text across a restart instead of losing it", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);
  speak(["the deploy was um already broken", true]);
  expect(getByTestId("words").textContent).toBe("6");

  endSession();
  expect(getByTestId("words").textContent).toBe("6");

  speak(["so I rolled it back", true]);
  expect(getByTestId("words").textContent).toBe("11");
  expect(getByTestId("fillers").textContent).toBe("1");

  speak(["so I rolled it back", true], ["and wrote the postmortem", false]);
  expect(getByTestId("words").textContent).toBe("15");
});

test("does not restart once the take is over", () => {
  installRecognition("SpeechRecognition");

  const { rerender } = render(<Harness active={true} />);
  const recognition = current();
  const during = recognition.onend;
  expect(during).not.toBeNull();

  rerender(<Harness active={false} />);

  expect(recognition.onend).toBeNull();
  expect(recognition.stopCalls).toBe(1);
  const afterTeardown = recognition.startCalls;

  act(() => during?.());
  expect(recognition.startCalls).toBe(afterTeardown);
});

test("gives up after a budget of restarts rather than spinning", () => {
  installRecognition("SpeechRecognition");
  const warned = mock((..._args: unknown[]) => {});
  console.warn = warned;

  const { getByTestId } = render(<Harness active={true} />);
  for (let i = 0; i < MAX_RESTARTS + 5; i++) endSession();

  expect(getByTestId("restarts").textContent).toBe(String(MAX_RESTARTS));
  expect(current().startCalls).toBe(MAX_RESTARTS + 1);
  expect(warned).toHaveBeenCalled();
});

test("survives a start() that throws and tries again on the next end", () => {
  installRecognition("SpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);
  FakeRecognition.failNextStart = true;

  expect(() => endSession()).not.toThrow();
  expect(getByTestId("restarts").textContent).toBe("1");

  endSession();
  expect(current().startCalls).toBe(3);
});

test("stops trying after the microphone is refused", () => {
  installRecognition("SpeechRecognition");

  render(<Harness active={true} />);
  act(() => current().onerror?.({ error: "not-allowed" }));
  endSession();

  expect(current().startCalls).toBe(1);
});

test("keeps going through a transient error, which arrives with an end of its own", () => {
  installRecognition("SpeechRecognition");

  render(<Harness active={true} />);
  act(() => current().onerror?.({ error: "no-speech" }));
  endSession();

  expect(current().startCalls).toBe(2);
});

test("uses the webkit-prefixed recogniser when that is the only one", () => {
  installRecognition("webkitSpeechRecognition");

  const { getByTestId } = render(<Harness active={true} />);

  expect(getByTestId("supported").textContent).toBe("true");
  expect(FakeRecognition.instances).toHaveLength(1);
});

test("reports an unsupported browser without ever throwing", () => {
  const { getByTestId, rerender, unmount } = render(<Harness active={true} />);

  expect(getByTestId("supported").textContent).toBe("false");
  expect(getByTestId("words").textContent).toBe("0");
  expect(getByTestId("fillers").textContent).toBe("0");
  expect(getByTestId("restarts").textContent).toBe("0");
  expect(FakeRecognition.instances).toHaveLength(0);

  expect(() => rerender(<Harness active={false} />)).not.toThrow();
  expect(() => rerender(<Harness active={true} />)).not.toThrow();
  expect(() => unmount()).not.toThrow();
});
