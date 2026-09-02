import { test, expect, beforeEach, afterEach } from "bun:test";
import { act, render } from "@testing-library/react";
import { readLocalVoicePref, useKokoro, writeLocalVoicePref, type LocalVoice } from "./useKokoro";

type Globals = { Worker?: unknown };

const realWorker = (globalThis as Globals).Worker;

let handle: LocalVoice | null = null;

function Harness({ enabled }: { enabled: boolean }) {
  handle = useKokoro(enabled);
  return <span data-testid="state">{handle.state}</span>;
}

beforeEach(() => {
  handle = null;
  localStorage.clear();
});

afterEach(() => {
  (globalThis as Globals).Worker = realWorker;
});

test("stays out of the way entirely when the preference is off", () => {
  const { getByTestId } = render(<Harness enabled={false} />);

  expect(getByTestId("state").textContent).toBe("disabled");
  expect(handle?.ready).toBe(false);
  expect(handle?.speak("Why did you leave?", "af_heart")).toBe(false);
});

test("says so rather than throwing when the browser has no worker to give it", () => {
  (globalThis as Globals).Worker = undefined;

  const { getByTestId } = render(<Harness enabled={true} />);

  expect(getByTestId("state").textContent).toBe("unsupported");
  expect(handle?.ready).toBe(false);
  expect(handle?.progress).toBeNull();
  expect(handle?.device).toBeNull();
});

test("stopping an idle voice is harmless", () => {
  (globalThis as Globals).Worker = undefined;
  render(<Harness enabled={true} />);

  expect(() => act(() => handle?.stop())).not.toThrow();
});

test("treats an unwritten preference as on and remembers a no", () => {
  expect(readLocalVoicePref()).toBe(true);

  writeLocalVoicePref(false);
  expect(readLocalVoicePref()).toBe(false);

  writeLocalVoicePref(true);
  expect(readLocalVoicePref()).toBe(true);
});
