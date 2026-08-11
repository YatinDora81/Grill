import { test, expect, mock } from "bun:test";

const SITE = "https://grill.yatindora.in";

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({ config: { site: { url: SITE } } }));

const { renderReportReadyEmail } = await import("./reportReady");

const INPUT = {
  sessionName: "Staff SRE — payments",
  score: 72,
  band: "Hire-able",
  headline:
    "The thing costing you the most is depth — you stop at the headline and leave the specifics that would prove it on the table.",
  reportUrl: `${SITE}/report/f0c1a2b3-0000-4000-8000-000000000001`,
  rematchUrl: `${SITE}/new?mode=weak_spots`,
};

const mail = () => renderReportReadyEmail(INPUT);

test("both bodies exist and carry content", () => {
  const { html, text } = mail();
  expect(html.length).toBeGreaterThan(500);
  expect(text.length).toBeGreaterThan(120);
  expect(html.startsWith("<!DOCTYPE")).toBe(true);
  expect(html.trimEnd().endsWith("</html>")).toBe(true);
  expect(text).not.toContain("<");
});

test("the subject carries the score and the verdict word", () => {
  expect(mail().subject).toBe("Your verdict is ready — 72/100, Hire-able");
});

test("the score never travels without the word that explains it", () => {
  const { html, text } = mail();
  for (const body of [html, text]) {
    expect(body).toContain("72");
    expect(body).toContain("Hire-able");
  }
  expect(html).toContain("Hire-able &mdash; 72");
  expect(text).toContain("Hire-able — 72/100");
});

test("the honest line is the body of both variants", () => {
  const { html, text } = mail();
  expect(html).toContain("The thing costing you the most is depth");
  expect(text).toContain(INPUT.headline);
});

test("both CTAs appear in both variants, as absolute URLs", () => {
  const { html, text } = mail();
  for (const body of [html, text]) {
    expect(body).toContain(INPUT.reportUrl);
    expect(body).toContain(INPUT.rematchUrl);
    expect(body).toContain("Read the full report");
    expect(body).toContain("Run the weak-spots rematch");
  }
  for (const href of html.match(/href="([^"]+)"/g) ?? []) {
    expect(href).toMatch(/href="https?:\/\//);
  }
});

test("the opt-out line is present in both variants", () => {
  const { html, text } = mail();
  expect(html).toContain("You can turn these off in Profile.");
  expect(text).toContain("You can turn these off in Profile.");
});

test("the document is pinned to the light stock", () => {
  const { html } = mail();
  for (const hex of ["#f4f0e6", "#fdfbf6", "#17140e", "#535045", "#d7d0be", "#bf2b10"]) {
    expect(html).toContain(hex);
  }
  expect(html).not.toContain("var(--");
  expect(html).toContain('name="color-scheme" content="light"');
  expect(html).not.toContain("#0e0e0e");
  expect(html).not.toContain("#e9e6df");
});

test("the CTA label knocks out of the ember fill in the stock colour", () => {
  const html = mail().html;
  expect(html).toContain(`background-color:#bf2b10`);
  expect(html).toMatch(/background-color:#bf2b10;[^"]*color:#f4f0e6/);
});

test("the session name is escaped, not interpolated raw", () => {
  const { html, text } = renderReportReadyEmail({
    ...INPUT,
    sessionName: '"Real" <interview> & co',
  });
  expect(html).toContain("&quot;Real&quot; &lt;interview&gt; &amp; co");
  expect(html).not.toContain("<interview>");
  expect(text).toContain('"Real" <interview> & co');
});

test("an unnamed session still renders", () => {
  const { html, text } = renderReportReadyEmail({ ...INPUT, sessionName: null });
  expect(html).toContain("Report ready");
  expect(text).toContain("REPORT READY");
  expect(html).toContain("Hire-able &mdash; 72");
});

test("a rough score keeps its own word", () => {
  const out = renderReportReadyEmail({ ...INPUT, score: 31, band: "Rough" });
  expect(out.subject).toBe("Your verdict is ready — 31/100, Rough");
  expect(out.html).toContain("Rough &mdash; 31");
  expect(out.text).toContain("Rough — 31/100");
});
