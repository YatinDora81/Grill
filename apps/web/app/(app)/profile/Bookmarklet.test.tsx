import { describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { Bookmarklet, bookmarkletHref } from "./Bookmarklet";

function source(href: string): string {
  expect(href.startsWith("javascript:")).toBe(true);
  return decodeURIComponent(href.slice("javascript:".length));
}

describe("bookmarkletHref", () => {
  test("points at /new in JD mode on the origin it was given", () => {
    expect(source(bookmarkletHref("https://grill.test"))).toContain('"https://grill.test/new?mode=jd"');
  });

  test("a trailing slash on the origin doesn't produce a double slash", () => {
    expect(source(bookmarkletHref("https://grill.test/"))).toContain('"https://grill.test/new?mode=jd"');
    expect(source(bookmarkletHref("https://grill.test//"))).not.toContain("test//new");
  });

  test("it reads exactly three things: the URL, the title and the visible text", () => {
    const js = source(bookmarkletHref("https://grill.test"));
    expect(js).toContain("location.href");
    expect(js).toContain("document.title");
    expect(js).toContain("innerText");
  });

  test("the page text goes in the FRAGMENT, which a browser never sends to a server", () => {
    const js = source(bookmarkletHref("https://grill.test"));
    expect(js).toContain('+"#import="+encodeURIComponent(JSON.stringify(d))');
    expect(js).not.toContain("?import=");
  });

  test("the scraped text is capped at what the extract route accepts", () => {
    expect(source(bookmarkletHref("https://grill.test"))).toContain("slice(0,60000)");
  });

  test("a page it cannot read fails with a message instead of throwing on someone's site", () => {
    const js = source(bookmarkletHref("https://grill.test"));
    expect(js).toContain("try{");
    expect(js).toContain("catch(e)");
  });
});

describe("Bookmarklet", () => {
  test("the href is set after mount, so React's URL sanitiser never sees it", async () => {
    const { getByTitle } = render(<Bookmarklet siteUrl="https://grill.test" />);
    const link = getByTitle("Drag me to your bookmarks bar") as HTMLAnchorElement;
    await waitFor(() => expect(link.getAttribute("href")).toBeTruthy());
    expect(link.getAttribute("href")).toBe(bookmarkletHref("https://grill.test"));
  });

  test("with no siteUrl it falls back to the origin it is being served from", async () => {
    const { getByTitle } = render(<Bookmarklet />);
    const link = getByTitle("Drag me to your bookmarks bar") as HTMLAnchorElement;
    await waitFor(() => expect(link.getAttribute("href")).toBeTruthy());
    expect(source(link.getAttribute("href")!)).toContain(`"${window.location.origin}/new?mode=jd"`);
  });

  test("it is draggable — that is the whole interaction", () => {
    const { getByTitle } = render(<Bookmarklet siteUrl="https://grill.test" />);
    expect(getByTitle("Drag me to your bookmarks bar").getAttribute("draggable")).toBe("true");
  });

  test("the compact variant drops the card and keeps the link plus one line", () => {
    const { getByText, queryByRole } = render(<Bookmarklet siteUrl="https://grill.test" compact />);
    expect(getByText("Grill this job")).toBeTruthy();
    expect(queryByRole("heading")).toBeNull();
    expect(getByText(/drag it to your bookmarks bar/)).toBeTruthy();
  });

  test("the full variant is a titled card", () => {
    const { getByRole } = render(<Bookmarklet siteUrl="https://grill.test" />);
    expect(getByRole("heading", { name: "Grill this job" })).toBeTruthy();
  });
});
