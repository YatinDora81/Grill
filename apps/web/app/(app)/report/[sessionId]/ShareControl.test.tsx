import { test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";

mock.module("react-hot-toast", () => ({
  default: { success: mock(() => {}), error: mock(() => {}) },
}));

let calls: string[];

beforeEach(() => {
  calls = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ url: "https://grill.test/r/tok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

const { ShareControl } = await import("./ShareControl");

test("a link already live on the server offers Revoke, without minting a second one", () => {
  const { getByRole, queryByRole } = render(
    <ShareControl sessionId="s1" sessionName="Staff backend, round 2" initiallyShared />,
  );

  expect(getByRole("button", { name: "Revoke" })).toBeTruthy();
  expect(queryByRole("textbox")).toBeNull();
  expect(calls).toEqual([]);
});

test("with nothing shared the control is the off state alone", () => {
  const { getByRole, queryByRole } = render(
    <ShareControl sessionId="s1" sessionName="Staff backend, round 2" />,
  );

  expect(getByRole("button", { name: "Share verdict" })).toBeTruthy();
  expect(queryByRole("button", { name: "Revoke" })).toBeNull();
});

test("revoking hands focus to the share button rather than dropping it to the body", async () => {
  const { getByRole } = render(
    <ShareControl sessionId="s1" sessionName="Staff backend, round 2" initiallyShared />,
  );

  const revoke = getByRole("button", { name: "Revoke" });
  revoke.focus();
  fireEvent.click(revoke);

  await waitFor(() => {
    const share = getByRole("button", { name: "Share verdict" });
    expect(document.activeElement === share).toBe(true);
  });
  expect(calls).toEqual(["DELETE /api/report/s1/share"]);
});

test("minting a link selects it, so it can be copied by hand", async () => {
  const { getByRole } = render(<ShareControl sessionId="s1" sessionName="Staff backend" />);

  fireEvent.click(getByRole("button", { name: "Share verdict" }));

  await waitFor(() => {
    const field = getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe("https://grill.test/r/tok");
    expect(field.selectionEnd).toBe(field.value.length);
  });
});
