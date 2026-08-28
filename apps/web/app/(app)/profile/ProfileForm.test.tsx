import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { User } from "@repo/types";

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
  (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ ...USER }), { status: 200 }));
    }),
);

function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

beforeEach(() => {
  fetchMock.mockClear();
  release = null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function mount() {
  const view = render(<ProfileForm user={USER} emailOnReport={false} emailDigest={false} />);
  const sw = view.getByRole("switch", {
    name: "Email me when a verdict is ready",
  }) as HTMLButtonElement;
  const digest = view.getByRole("switch", {
    name: "Email me the weekly drill digest",
  }) as HTMLButtonElement;
  return { view, sw, digest };
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

test("the digest switch keeps focus and stays operable across the save", async () => {
  const { digest } = mount();
  digest.focus();
  fireEvent.click(digest);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(digest.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(digest);
  expect(digest.getAttribute("aria-checked")).toBe("true");

  release?.();
  await waitFor(() => expect(digest.getAttribute("aria-busy")).toBe("false"));
});

test("a second press on the digest switch during the save doesn't queue a second write", async () => {
  const { digest } = mount();
  fireEvent.click(digest);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  fireEvent.click(digest);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(digest.getAttribute("aria-checked")).toBe("true");

  release?.();
  await waitFor(() => expect(digest.getAttribute("aria-busy")).toBe("false"));
});

test("each switch patches its own field, and only its own", async () => {
  const { sw, digest } = mount();

  fireEvent.click(digest);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(sentBody(0)).toEqual({ email_digest: true });
  release?.();
  await waitFor(() => expect(digest.getAttribute("aria-busy")).toBe("false"));

  fireEvent.click(sw);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(sentBody(1)).toEqual({ email_on_report: true });
  release?.();
  await waitFor(() => expect(sw.getAttribute("aria-busy")).toBe("false"));
});

test("a failed digest save puts the switch back where it was", async () => {
  fetchMock.mockImplementationOnce(
    () => Promise.resolve(new Response(JSON.stringify({}), { status: 500 })) as Promise<Response>,
  );
  const { digest } = mount();

  fireEvent.click(digest);
  expect(digest.getAttribute("aria-checked")).toBe("true");

  await waitFor(() => expect(digest.getAttribute("aria-checked")).toBe("false"));
  expect(digest.getAttribute("aria-busy")).toBe("false");
});
