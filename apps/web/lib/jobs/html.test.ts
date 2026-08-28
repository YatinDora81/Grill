import { describe, expect, test } from "bun:test";
import { decodeEntities, extractJsonLdJobPosting, stripHtml } from "./html";

describe("decodeEntities", () => {
  test("named, decimal and hex entities all come back as characters", () => {
    expect(decodeEntities("Ben &amp; Jerry&#39;s")).toBe("Ben & Jerry's");
    expect(decodeEntities("caf&#233;")).toBe("café");
    expect(decodeEntities("caf&#xe9;")).toBe("café");
    expect(decodeEntities("&ldquo;ship it&rdquo; &mdash; the team")).toBe("“ship it” — the team");
  });

  test("a non-breaking space becomes a plain one, so word counts stay honest", () => {
    expect(decodeEntities("3&nbsp;years")).toBe("3 years");
  });

  test("an entity we don't know is left exactly as written", () => {
    expect(decodeEntities("&notarealentity; &amp;")).toBe("&notarealentity; &");
  });

  test("only ONE layer is decoded, so a page can't smuggle a tag through", () => {
    expect(decodeEntities("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  test("a lone surrogate or an out-of-range code point is not decoded", () => {
    expect(decodeEntities("&#xd800;")).toBe("&#xd800;");
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
    expect(decodeEntities("&#0;")).toBe("&#0;");
  });
});

describe("stripHtml", () => {
  test("script and style contents are dropped, not merely untagged", () => {
    const html = "<p>Real text</p><script>var leak = 1;</script><style>.x{color:red}</style>";
    const out = stripHtml(html);
    expect(out).toContain("Real text");
    expect(out).not.toContain("leak");
    expect(out).not.toContain("color:red");
  });

  test("list items keep their shape, so a requirements list still reads as one", () => {
    const out = stripHtml("<ul><li>Go</li><li>Postgres</li></ul>");
    expect(out).toBe("• Go\n• Postgres");
  });

  test("block ends and <br> become line breaks", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(stripHtml("One<br/>Two")).toBe("One\nTwo");
  });

  test("entities are decoded AFTER the tags are gone", () => {
    expect(stripHtml("<p>Write &lt;script&gt; safely</p>")).toBe("Write <script> safely");
  });

  test("blank-line runs collapse and lines are trimmed", () => {
    expect(stripHtml("<div>  a  </div><div></div><div></div><div>  b </div>")).toBe("a\n\nb");
  });

  test("comments are removed", () => {
    expect(stripHtml("<!-- hidden --><p>shown</p>")).toBe("shown");
  });

  test("empty input is an empty string, never a throw", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("Greenhouse's double-encoded body", () => {
  test("decode once, then strip, and the markup disappears while the text stays", () => {
    const content =
      "&lt;p&gt;&lt;strong&gt;About the role&lt;/strong&gt;&lt;/p&gt;" +
      "&lt;ul&gt;&lt;li&gt;Own the billing pipeline&lt;/li&gt;" +
      "&lt;li&gt;Go &amp;amp; Postgres&lt;/li&gt;&lt;/ul&gt;";
    const out = stripHtml(decodeEntities(content));
    expect(out).toBe("About the role\n\n• Own the billing pipeline\n• Go & Postgres");
  });
});

const ld = (payload: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body>x</body></html>`;

const POSTING = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Senior Backend Engineer",
  description: "<p>You will own the billing pipeline.</p>",
  hiringOrganization: { "@type": "Organization", name: "Acme" },
  jobLocation: {
    "@type": "Place",
    address: { "@type": "PostalAddress", addressLocality: "Bengaluru", addressCountry: "IN" },
  },
};

describe("extractJsonLdJobPosting", () => {
  test("a single JobPosting object", () => {
    expect(extractJsonLdJobPosting(ld(POSTING))).toEqual({
      title: "Senior Backend Engineer",
      company: "Acme",
      location: "Bengaluru, IN",
      description: "<p>You will own the billing pipeline.</p>",
    });
  });

  test("an array of objects — the JobPosting is found among the others", () => {
    const found = extractJsonLdJobPosting(
      ld([{ "@type": "BreadcrumbList", itemListElement: [] }, POSTING]),
    );
    expect(found?.title).toBe("Senior Backend Engineer");
  });

  test("an @graph wrapper", () => {
    const found = extractJsonLdJobPosting(ld({ "@context": "x", "@graph": [{ "@type": "WebSite" }, POSTING] }));
    expect(found?.company).toBe("Acme");
  });

  test("@type as an array", () => {
    const found = extractJsonLdJobPosting(ld({ ...POSTING, "@type": ["JobPosting", "Thing"] }));
    expect(found?.title).toBe("Senior Backend Engineer");
  });

  test("a malformed block is skipped, and a good one after it still wins", () => {
    const html = `<script type="application/ld+json">{ not json ]</script>${ld(POSTING)}`;
    expect(extractJsonLdJobPosting(html)?.title).toBe("Senior Backend Engineer");
  });

  test("a page with no JobPosting returns null rather than a half-filled object", () => {
    expect(extractJsonLdJobPosting(ld({ "@type": "Organization", name: "Acme" }))).toBeNull();
    expect(extractJsonLdJobPosting("<html><body>nothing here</body></html>")).toBeNull();
  });

  test("hiringOrganization as a bare string is still a company", () => {
    const found = extractJsonLdJobPosting(ld({ ...POSTING, hiringOrganization: "Acme Labs" }));
    expect(found?.company).toBe("Acme Labs");
  });

  test("jobLocation as an array takes the first usable place", () => {
    const found = extractJsonLdJobPosting(
      ld({ ...POSTING, jobLocation: [{ "@type": "Place" }, { address: { addressLocality: "London" } }] }),
    );
    expect(found?.location).toBe("London");
  });

  test("a remote posting with no Place reads as Remote, not as nothing", () => {
    const found = extractJsonLdJobPosting(
      ld({ ...POSTING, jobLocation: undefined, jobLocationType: "TELECOMMUTE" }),
    );
    expect(found?.location).toBe("Remote");
  });

  test("a missing company is null, never a guess from the page", () => {
    const found = extractJsonLdJobPosting(ld({ ...POSTING, hiringOrganization: undefined }));
    expect(found?.company).toBeNull();
  });

  test("an entity-escaped block is still parsed", () => {
    const raw = JSON.stringify(POSTING).replace(/"/g, "&quot;");
    const found = extractJsonLdJobPosting(`<script type="application/ld+json">${raw}</script>`);
    expect(found?.title).toBe("Senior Backend Engineer");
  });

  test("a self-referential @graph terminates instead of spinning", () => {
    const nested = Array.from({ length: 40 }).reduce<string>(
      (inner) => `{"@graph":${inner}}`,
      '{"@type":"JobPosting","title":"deep"}',
    );
    expect(extractJsonLdJobPosting(`<script type="application/ld+json">${nested}</script>`)).toBeNull();
  });
});
