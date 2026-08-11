import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

function jsxRegion(idAttr: string): string {
  const at = SRC.indexOf(idAttr);
  expect(at).toBeGreaterThan(-1);
  const open = SRC.lastIndexOf("<", at);
  const lineStart = SRC.lastIndexOf("\n", open) + 1;
  const indent = SRC.slice(lineStart, open);
  const rest = SRC.slice(open);
  const end = rest.search(new RegExp(`\\n${indent}<`));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the every-question region", () => {
  const region = jsxRegion('id="questions"');

  it("renders the karaoke replay", () => {
    expect(region).toContain("<Replay");
  });

  it("carries an explain note beside it", () => {
    expect(region).toContain("<Explain>");
  });

  it("tells the reader the words are clickable, which nothing else on the surface does", () => {
    const note = region.slice(region.indexOf("<Explain>"), region.indexOf("</Explain>"));
    expect(note).toMatch(/click/i);
  });
});
