import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { User } from "@repo/types";

/**
 * Queries come from `render()`, never `screen`: test/setup.ts imports
 * @testing-library/react before registering happy-dom, so `screen` is bound to a
 * document that doesn't exist yet and throws on every query.
 */

const router = {
  refresh: mock(() => {}),
  push: mock(() => {}),
  replace: mock(() => {}),
  back: mock(() => {}),
  forward: mock(() => {}),
  prefetch: mock(() => {}),
};
mock.module("next/navigation", () => ({ useRouter: () => router }));

const { ProfileForm } = await import("./ProfileForm");

const USER: User = { id: "u1", email: "sam@example.com", name: "Sam" };

let release: (() => void) | null = null;
const fetchMock = mock(
  () =>
    new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ ...USER }), { status: 200 }));
    }),
);

beforeEach(() => {
  fetchMock.mockClear();
  release = null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function mount() {
  const view = render(<ProfileForm user={USER} emailOnReport={false} />);
  const sw = view.getByRole("switch") as HTMLButtonElement;
  return { view, sw };
}

test("the mail switch keeps focus and stays operable across the save", async () => {
  const { sw } = mount();
  sw.focus();
  fireEvent.click(sw);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(sw.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(sw);
  expect(sw.getAttribute("aria-checked")).toBe("true");

  release?.();
  await waitFor(() => expect(sw.getAttribute("aria-busy")).toBe("false"));
});

test("a second press during the save doesn't queue a second write", async () => {
  const { sw } = mount();
  fireEvent.click(sw);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  fireEvent.click(sw);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sw.getAttribute("aria-checked")).toBe("true");

  release?.();
  await waitFor(() => expect(sw.getAttribute("aria-busy")).toBe("false"));
});
