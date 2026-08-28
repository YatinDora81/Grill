import { test, expect, describe, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { ExclusiveMode, JobImportResponse } from "@repo/types";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

interface Call {
  path: string;
  body: unknown;
}

const JOB: JobImportResponse = {
  title: "Senior Backend Engineer",
  company: "Acme",
  location: "Bengaluru",
  description: "Own the billing pipeline. Go, Postgres, and the on-call pager.",
  source: "bookmarklet",
  url: "https://www.linkedin.com/jobs/view/1",
};

let calls: Call[] = [];
let replies: Record<string, { status: number; body: unknown }> = {};

beforeEach(() => {
  calls = [];
  replies = {
    "/api/interview/jd/extract": { status: 200, body: JOB },
    "/api/interview/resume/extract": { status: 200, body: { text: "Six years of Go.", chars: 16 } },
    "/api/interview/start": { status: 200, body: { session_id: "sess_1", question: null } },
  };
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const raw = init?.body;
    calls.push({ path, body: typeof raw === "string" ? JSON.parse(raw) : raw });
    const reply = replies[path] ?? {
      status: 404,
      body: { error: { code: "not_found", message: `no test route for ${path}` } },
    };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  router.push.mockClear();
  window.location.hash = "";
});

const router = {
  push: mock(() => {}),
  replace: mock(() => {}),
  refresh: mock(() => {}),
  back: mock(() => {}),
  forward: mock(() => {}),
  prefetch: mock(() => {}),
};
mock.module("next/navigation", () => ({ useRouter: () => router }));

const { NewInterviewForm } = await import("./NewInterviewForm");
const { default: NewInterviewPage } = await import("./page");
const { MODE_META, SOURCE_META } = await import("@/lib/interviewMeta");

interface FormProps {
  initialMode?: ExclusiveMode | null;
  initialStarredHashes?: string[];
}

function findForm(node: ReactNode): FormProps | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findForm(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === NewInterviewForm) return el.props as FormProps;
  return findForm(el.props.children ?? null);
}

async function formPropsFor(params: Record<string, string>): Promise<FormProps> {
  const tree = await NewInterviewPage({ searchParams: Promise.resolve(params) });
  const props = findForm(tree);
  if (!props) throw new Error("the page rendered no NewInterviewForm");
  return props;
}

describe("the mode a link asks /new for", () => {
  test("the report mail's rematch link arrives as a seeded mode", async () => {
    expect((await formPropsFor({ mode: "weak_spots" })).initialMode).toBe("weak_spots");
  });

  test("every other exclusive mode survives the trip too", async () => {
    expect((await formPropsFor({ mode: "jd" })).initialMode).toBe("jd");
    expect((await formPropsFor({ mode: "project" })).initialMode).toBe("project");
  });

  test("a mode that isn't one is dropped", async () => {
    expect((await formPropsFor({ mode: "definitely_not_a_mode" })).initialMode).toBe(null);
    expect((await formPropsFor({})).initialMode).toBe(null);
  });

  test("the starred drill link still arrives as hashes, not as a mode", async () => {
    const h = "a".repeat(64);
    const props = await formPropsFor({ mode: "starred", h });
    expect(props.initialStarredHashes).toEqual([h]);
    expect(props.initialMode).toBe(null);
  });

  test("starred with no usable hashes stays the ordinary form", async () => {
    const props = await formPropsFor({ mode: "starred", h: "nope" });
    expect(props.initialStarredHashes).toEqual([]);
    expect(props.initialMode).toBe(null);
  });
});

describe("a form opened on a seeded mode", () => {
  test("draws on that mode rather than the résumé blend", () => {
    const { getByText } = render(<NewInterviewForm initialMode="weak_spots" />);
    expect(getByText("Draws on").parentElement?.textContent).toContain(MODE_META.weak_spots.label);
  });

  test("without one it still opens on the résumé blend", () => {
    const { getByText } = render(<NewInterviewForm />);
    expect(getByText("Draws on").parentElement?.textContent).toContain(SOURCE_META.resume.label);
  });

  test("the picker shows it already chosen", () => {
    const { getByRole } = render(<NewInterviewForm initialMode="weak_spots" />);
    fireEvent.click(getByRole("button", { name: /^Next/ }));
    const modes = within(getByRole("radiogroup", { name: "Interview mode" }));
    const chosen = modes
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.textContent).toContain(MODE_META.weak_spots.label);
  });
});

type View = ReturnType<typeof render>;

function typeInto(field: HTMLElement, value: string): void {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: "e" });
  fireEvent.blur(field);
}

const hashFor = (payload: unknown) => `#import=${encodeURIComponent(JSON.stringify(payload))}`;

async function uploadResume(view: View): Promise<void> {
  const input = view.container.querySelector("#resume") as HTMLInputElement;
  const file = new File(["Six years of Go."], "cv.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await view.findByText(/Parsed from/);
}

async function startInterview(view: View, name?: string): Promise<Record<string, unknown>> {
  fireEvent.click(view.getByRole("button", { name: /^Next/ }));
  fireEvent.click(view.getByRole("button", { name: /^Next/ }));
  if (name) typeInto(view.getByLabelText("Interview name"), name);
  fireEvent.click(view.getByRole("button", { name: /Take the hot seat/ }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/interview/start")).toBe(true));
  const started = calls.find((c) => c.path === "/api/interview/start");
  return (started?.body as { config: Record<string, unknown> }).config;
}

describe("the JD step", () => {
  test("offers the importer, so a posting can arrive as a link", () => {
    const { getByLabelText, getByRole } = render(<NewInterviewForm initialMode="jd" />);
    expect(getByLabelText("Job posting URL")).toBeTruthy();
    expect(getByRole("button", { name: "Import" })).toBeTruthy();
  });

  test("a company can be named by hand, not only imported", () => {
    const { getByLabelText } = render(<NewInterviewForm initialMode="jd" />);
    expect((getByLabelText("Company") as HTMLInputElement).value).toBe("");
    expect((getByLabelText("Posting title") as HTMLInputElement).value).toBe("");
  });

  test("naming a company brings up the prep brief; nothing is fetched until it is asked for", () => {
    const view = render(<NewInterviewForm initialMode="jd" />);
    expect(view.queryByRole("button", { name: /Build my prep brief/ })).toBeNull();

    typeInto(view.getByLabelText("Company"), "Acme");

    expect(view.getByRole("button", { name: /Build my prep brief/ })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  test("the brief is only offered in JD mode, where the company field lives", () => {
    const { queryByLabelText } = render(<NewInterviewForm initialMode="topic_only" />);
    expect(queryByLabelText("Company")).toBeNull();
  });
});

describe("the bookmarklet's handoff", () => {
  test("imports the page the user's own browser read, and fills the JD block from it", async () => {
    window.location.hash = hashFor({
      u: JOB.url,
      t: "Senior Backend Engineer | Acme",
      x: "the posting text, scraped from the tab",
    });
    const view = render(<NewInterviewForm />);

    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/interview/jd/extract")).toBe(true),
    );
    const sent = calls.find((c) => c.path === "/api/interview/jd/extract");
    expect(sent?.body).toEqual({
      url: JOB.url,
      page_title: "Senior Backend Engineer | Acme",
      page_text: "the posting text, scraped from the tab",
    });

    expect(window.location.hash).toBe("");

    await waitFor(() =>
      expect((view.getByLabelText("Company") as HTMLInputElement).value).toBe("Acme"),
    );
    expect((view.getByLabelText("Job description") as HTMLTextAreaElement).value).toBe(
      JOB.description,
    );
    expect((view.getByLabelText("Posting title") as HTMLInputElement).value).toBe(JOB.title);
  });

  test("what the posting named rides along in the config", async () => {
    window.location.hash = hashFor({ u: JOB.url, x: "the posting text" });
    const view = render(<NewInterviewForm />);
    await waitFor(() =>
      expect((view.getByLabelText("Company") as HTMLInputElement).value).toBe("Acme"),
    );
    await uploadResume(view);

    const config = await startInterview(view);
    expect(config).toMatchObject({
      mode: "jd",
      job_description: JOB.description,
      job_url: JOB.url,
      company: "Acme",
      job_title: JOB.title,
      job_location: "Bengaluru",
    });
    expect(router.push).toHaveBeenCalledWith("/session/sess_1");
  });

  test("a posting typed out by hand sends the company and no link", async () => {
    const view = render(<NewInterviewForm initialMode="jd" />);
    typeInto(view.getByLabelText("Job description"), "Own the billing pipeline.");
    typeInto(view.getByLabelText("Company"), "  Acme  ");
    await uploadResume(view);

    const config = await startInterview(view, "Acme backend");
    expect(config.company).toBe("Acme");
    expect(config.job_url).toBeUndefined();
    expect(config.job_title).toBeUndefined();
    expect(config.job_location).toBeUndefined();
  });
});
