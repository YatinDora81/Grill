import { test, expect, mock } from "bun:test";

const SITE = "https://grill.yatindora.in";

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({ config: { site: { url: SITE } } }));

const { renderDrillDigestEmail } = await import("./drillDigest");

const INPUT = {
  name: "Sam Okonkwo",
  dueCount: 3,
  streakDays: 6,
  firstQuestion: "Tell me about a time you shipped something that broke in production.",
  drillUrl: `${SITE}/drill`,
  profileUrl: `${SITE}/profile`,
};

const mail = (patch: Partial<typeof INPUT> = {}) => renderDrillDigestEmail({ ...INPUT, ...patch });

test("both bodies exist and are well-formed documents", () => {
  const { html, text } = mail();
  expect(html.length).toBeGreaterThan(500);
  expect(text.length).toBeGreaterThan(120);
  expect(html.startsWith("<!DOCTYPE")).toBe(true);
  expect(html.trimEnd().endsWith("</html>")).toBe(true);
  expect(text).not.toContain("<");
});

test("the subject names the count, and the streak once it is worth keeping", () => {
  expect(mail().subject).toBe("3 questions due — and a 6-day streak to keep");
  expect(mail({ dueCount: 1, streakDays: 0 }).subject).toBe("1 question due in your drill");
  expect(mail({ streakDays: 1 }).subject).toBe("3 questions due in your drill");
});

test("the first due question travels verbatim in both bodies", () => {
  const { html, text } = mail();
  expect(html).toContain(INPUT.firstQuestion);
  expect(text).toContain(INPUT.firstQuestion);
  expect(html).toContain("First one up");
});

test("a broken streak is stated plainly, not hidden and not scolded", () => {
  const { html, text } = mail({ streakDays: 0 });
  for (const body of [html, text]) {
    expect(body).toContain("Your streak has ended");
    expect(body).toContain("One drill restarts it");
  }
  expect(html).not.toContain("6 days deep");
});

test("a live streak says how many days are on the line", () => {
  expect(mail({ streakDays: 6 }).text).toContain("You are 6 days deep");
  expect(mail({ streakDays: 1 }).text).toContain("You are one day in");
});

test("the drill link and the opt-out both appear in both bodies", () => {
  const { html, text } = mail();
  for (const body of [html, text]) {
    expect(body).toContain(INPUT.drillUrl);
    expect(body).toContain(INPUT.profileUrl);
  }
  expect(html).toContain("Start today&#39;s drill");
  expect(text).toContain("Start today's drill");
});

test("every nudge says how to stop getting it", () => {
  const { html, text } = mail();
  expect(html).toContain("Turn it off in Profile");
  expect(text).toContain("You can turn this weekly nudge off in Profile.");
});

test("only the first name is used, and it is escaped in the HTML", () => {
  const { html, text } = mail({ name: "Sam&<Jo> Okonkwo" });
  expect(html).not.toContain("Okonkwo");
  expect(html).toContain("Hi Sam&amp;&lt;Jo&gt;,");
  expect(text).toContain("Hi Sam&<Jo>,");
});

test("a question with markup in it cannot break out into the document", () => {
  const nasty = 'What about <script>alert("x")</script> injection?';
  const { html } = mail({ firstQuestion: nasty });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("a nameless account still gets a greeting", () => {
  const { html, text } = mail({ name: null });
  expect(html).toContain("Hi,");
  expect(text).toContain("Hi,");
});

test("a deck that emptied between selection and send drops the question block cleanly", () => {
  const { html, text } = mail({ firstQuestion: null });
  expect(html).not.toContain("First one up");
  expect(text).not.toContain("First one up");
  expect(html).toContain(INPUT.drillUrl);
});
