import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import type { JobImportResponse } from "@repo/types";

interface Call {
  path: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: null };

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: null };
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

const { JobUrlImport, readImportHandoff } = await import("./JobUrlImport");

const JOB: JobImportResponse = {
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Bengaluru",
  description: "Own the billing pipeline.",
  source: "lever",
  url: "https://jobs.lever.co/acme/1b0f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
};

const hashFor = (payload: unknown) => `#import=${encodeURIComponent(JSON.stringify(payload))}`;

describe("readImportHandoff", () => {
  test("reads the bookmarklet's three fields", () => {
    const hash = hashFor({ u: "https://acme.test/j/1", t: "Backend | Acme", x: "posting text" });
    expect(readImportHandoff(hash)).toEqual({
      url: "https://acme.test/j/1",
      page_title: "Backend | Acme",
      page_text: "posting text",
    });
  });

  test("works with or without the leading #", () => {
    const payload = { u: "https://acme.test/j/1", x: "text" };
    expect(readImportHandoff(hashFor(payload))?.url).toBe("https://acme.test/j/1");
    expect(readImportHandoff(hashFor(payload).slice(1))?.url).toBe("https://acme.test/j/1");
  });

  test("a literal + in the page text survives — 'C++' must not become 'C  '", () => {
    const handoff = readImportHandoff(hashFor({ u: "https://acme.test/j", x: "5 years of C++ and Go" }));
    expect(handoff?.page_text).toBe("5 years of C++ and Go");
  });

  test("a title is optional; an empty one is dropped rather than sent as ''", () => {
    const handoff = readImportHandoff(hashFor({ u: "https://acme.test/j", t: "  ", x: "text" }));
    expect(handoff?.page_title).toBeUndefined();
  });

  test("an ordinary hash, or none, is not a handoff", () => {
    expect(readImportHandoff("")).toBeNull();
    expect(readImportHandoff("#section-2")).toBeNull();
    expect(readImportHandoff("#importer=1")).toBeNull();
  });

  test("malformed JSON in the fragment is ignored, never thrown on", () => {
    expect(readImportHandoff("#import=%7Bnot-json")).toBeNull();
    expect(readImportHandoff("#import=")).toBeNull();
  });

  test("the fragment is attacker-writable, so a non-https URL is refused", () => {
    expect(readImportHandoff(hashFor({ u: "javascript:alert(1)", x: "text" }))).toBeNull();
    expect(readImportHandoff(hashFor({ u: "http://acme.test/j", x: "text" }))).toBeNull();
    expect(readImportHandoff(hashFor({ u: "data:text/html,x", x: "text" }))).toBeNull();
  });

  test("missing or non-string fields are refused", () => {
    expect(readImportHandoff(hashFor({ u: "https://acme.test/j" }))).toBeNull();
    expect(readImportHandoff(hashFor({ x: "text" }))).toBeNull();
    expect(readImportHandoff(hashFor({ u: "https://acme.test/j", x: 42 }))).toBeNull();
    expect(readImportHandoff(hashFor({ u: "https://acme.test/j", x: "   " }))).toBeNull();
    expect(readImportHandoff(hashFor("a string, not an object"))).toBeNull();
  });

  test("an oversized page is truncated rather than refused", () => {
    const handoff = readImportHandoff(hashFor({ u: "https://acme.test/j", x: "z".repeat(90_000) }));
    expect(handoff?.page_text).toHaveLength(60_000);
  });
});

describe("JobUrlImport", () => {
  const HANDOFF = {
    url: "https://www.linkedin.com/jobs/view/1",
    page_title: "Backend | Acme",
    page_text: "the posting text",
  };

  test("with no handoff nothing is requested on mount, and Import is disabled", () => {
    const { getByRole } = render(<JobUrlImport onImported={() => {}} />);
    expect(calls).toEqual([]);
    expect((getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a bookmarklet handoff imports itself once, sending the page text", async () => {
    reply = { status: 200, body: { ...JOB, source: "bookmarklet" } };
    const onImported = mock((_job: JobImportResponse) => {});
    const { rerender } = render(<JobUrlImport onImported={onImported} handoff={HANDOFF} />);

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      {
        path: "/api/interview/jd/extract",
        body: { url: HANDOFF.url, page_title: HANDOFF.page_title, page_text: HANDOFF.page_text },
      },
    ]);

    rerender(<JobUrlImport onImported={onImported} handoff={HANDOFF} />);
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  test("a handoff with no title omits the field rather than sending an empty one", async () => {
    reply = { status: 200, body: { ...JOB, source: "bookmarklet" } };
    render(<JobUrlImport onImported={() => {}} handoff={{ url: HANDOFF.url, page_text: "text" }} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ url: HANDOFF.url, page_text: "text" });
  });

  test("what was imported is shown back, so the user can see it took the right posting", async () => {
    reply = { status: 200, body: JOB };
    const { findByText } = render(<JobUrlImport onImported={() => {}} handoff={HANDOFF} />);
    expect(await findByText(/Senior Backend Engineer/)).toBeTruthy();
    expect(await findByText(/Acme/)).toBeTruthy();
  });

  test("a login wall shows the bookmarklet, because retrying cannot fix it", async () => {
    reply = {
      status: 422,
      body: { error: { code: "login_wall", message: "That page needs a login." } },
    };
    const { findByText } = render(<JobUrlImport onImported={() => {}} handoff={HANDOFF} />);

    expect(await findByText("That page needs a login.")).toBeTruthy();
    expect(await findByText("Grill this job")).toBeTruthy();
  });

  test("any other failure shows the server's message and no bookmarklet", async () => {
    reply = {
      status: 422,
      body: { error: { code: "not_a_posting", message: "We couldn't find a job posting." } },
    };
    const { findByText, queryByText } = render(
      <JobUrlImport onImported={() => {}} handoff={HANDOFF} />,
    );

    expect(await findByText("We couldn't find a job posting.")).toBeTruthy();
    expect(queryByText("Grill this job")).toBeNull();
  });

  test("a failed import never hands a half-built posting to the form", async () => {
    reply = { status: 500, body: { error: { code: "internal_error", message: "Something went wrong." } } };
    const onImported = mock((_job: JobImportResponse) => {});
    const { findByText } = render(<JobUrlImport onImported={onImported} handoff={HANDOFF} />);
    expect(await findByText("Something went wrong.")).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();
  });
});
