import { expect, test } from "bun:test";
import { MAX_DIFF_CELLS, diffWords, normalizeToken, tokenizeWords } from "./words";

const t = (text: string) => tokenizeWords(text);

test("two identical answers are one keep run, not a word-by-word list", () => {
  const ops = diffWords(t("we sharded the write path"), t("we sharded the write path"));

  expect(ops).toEqual([{ op: "keep", text: "we sharded the write path" }]);
});

test("an insertion at the start is one add run", () => {
  const ops = diffWords(t("we sharded the writes"), t("first we sharded the writes"));

  expect(ops).toEqual([
    { op: "add", text: "first" },
    { op: "keep", text: "we sharded the writes" },
  ]);
});

test("an insertion in the middle keeps both sides intact around it", () => {
  const ops = diffWords(t("we sharded the writes"), t("we finally sharded the writes"));

  expect(ops).toEqual([
    { op: "keep", text: "we" },
    { op: "add", text: "finally" },
    { op: "keep", text: "sharded the writes" },
  ]);
});

test("an insertion at the end is one trailing add", () => {
  const ops = diffWords(t("we sharded the writes"), t("we sharded the writes twice"));

  expect(ops).toEqual([
    { op: "keep", text: "we sharded the writes" },
    { op: "add", text: "twice" },
  ]);
});

test("a deletion in the middle is one del run", () => {
  const ops = diffWords(t("we sort of sharded the writes"), t("we sharded the writes"));

  expect(ops).toEqual([
    { op: "keep", text: "we" },
    { op: "del", text: "sort of" },
    { op: "keep", text: "sharded the writes" },
  ]);
});

test("a deletion at the start and at the end both survive the merge", () => {
  const ops = diffWords(t("um we sharded the writes honestly"), t("we sharded the writes"));

  expect(ops).toEqual([
    { op: "del", text: "um" },
    { op: "keep", text: "we sharded the writes" },
    { op: "del", text: "honestly" },
  ]);
});

test("a replaced phrase reads as one deletion followed by one addition", () => {
  const ops = diffWords(t("we guessed at the index"), t("we measured the index"));

  expect(ops).toEqual([
    { op: "keep", text: "we" },
    { op: "del", text: "guessed at" },
    { op: "add", text: "measured" },
    { op: "keep", text: "the index" },
  ]);
});

test("case and edge punctuation do not count as a change, and the now spelling wins", () => {
  const ops = diffWords(t("Kubernetes, then postgres"), t('"kubernetes" then Postgres.'));

  expect(ops).toEqual([{ op: "keep", text: '"kubernetes" then Postgres.' }]);
});

test("a token that is only punctuation still compares against itself", () => {
  expect(normalizeToken("—")).toBe("—");
  expect(diffWords(t("we shipped — twice"), t("we shipped — twice"))).toEqual([
    { op: "keep", text: "we shipped — twice" },
  ]);
});

test("an empty side becomes a single add or del, never an empty diff", () => {
  expect(diffWords([], t("a whole new answer"))).toEqual([
    { op: "add", text: "a whole new answer" },
  ]);
  expect(diffWords(t("the old answer"), [])).toEqual([{ op: "del", text: "the old answer" }]);
  expect(diffWords([], [])).toEqual([]);
});

test("past the cell cap the diff degrades to a wholesale replacement instead of hanging", () => {
  const size = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
  const then = Array.from({ length: size }, (_, i) => `alpha${i}`);
  const now = Array.from({ length: size }, (_, i) => `beta${i}`);

  const started = performance.now();
  const ops = diffWords(then, now);
  const elapsed = performance.now() - started;

  expect(ops).toEqual([
    { op: "del", text: then.join(" ") },
    { op: "add", text: now.join(" ") },
  ]);
  expect(elapsed).toBeLessThan(500);
});

test("right at the cap the real diff still runs", () => {
  const side = Math.floor(Math.sqrt(MAX_DIFF_CELLS));
  const words = Array.from({ length: side }, (_, i) => `word${i}`);
  const ops = diffWords(words, words);

  expect(ops).toEqual([{ op: "keep", text: words.join(" ") }]);
});

test("tokenising ignores runs of whitespace rather than inventing empty words", () => {
  expect(tokenizeWords("  we   sharded\nthe writes  ")).toEqual(["we", "sharded", "the", "writes"]);
  expect(tokenizeWords("   ")).toEqual([]);
});
