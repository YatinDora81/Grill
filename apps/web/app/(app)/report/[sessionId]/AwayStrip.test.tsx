import { test, expect, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import type { AwaySegment } from "@repo/types";

const { AwayStrip } = await import("./AwayStrip");

const SEGMENTS: AwaySegment[] = [
  { start_ms: 15_000, end_ms: 30_000 },
  { start_ms: 45_000, end_ms: 48_000 },
];
const TOTAL = 60_000;

test("nothing renders when the answer had no look-aways", () => {
  const { container } = render(<AwayStrip segments={[]} totalMs={TOTAL} />);
  expect(container.textContent).toBe("");
});

test("nothing renders when the take has no measurable length to span", () => {
  const { container } = render(<AwayStrip segments={SEGMENTS} totalMs={0} />);
  expect(container.textContent).toBe("");
});

test("each run is one block, placed where it happened in the take", () => {
  const { getAllByRole } = render(
    <AwayStrip segments={SEGMENTS} totalMs={TOTAL} onSeek={() => {}} />,
  );
  const blocks = getAllByRole("button");
  expect(blocks).toHaveLength(2);
  expect(blocks[0]!.style.left).toBe("25%");
  expect(blocks[0]!.style.width).toBe("25%");
  expect(blocks[1]!.style.left).toBe("75%");
});

test("a block seeks the clip to the second the run started", () => {
  const onSeek = mock((_seconds: number) => {});
  const { getAllByRole } = render(
    <AwayStrip segments={SEGMENTS} totalMs={TOTAL} onSeek={onSeek} />,
  );
  fireEvent.click(getAllByRole("button")[1]!);
  expect(onSeek).toHaveBeenCalledTimes(1);
  expect(onSeek.mock.calls[0]![0]).toBe(45);
});

test("the label states the duration and where it happened, and claims nothing more", () => {
  const { getAllByRole } = render(
    <AwayStrip segments={SEGMENTS} totalMs={TOTAL} onSeek={() => {}} />,
  );
  const label = getAllByRole("button")[0]!.getAttribute("aria-label") ?? "";
  expect(label).toContain("Looked away for 15.0 s at 0:15");
  for (const word of ["confident", "confidence", "nervous", "distracted", "engaged"]) {
    expect(label.toLowerCase()).not.toContain(word);
  }
});

test("with no clip to seek there is nothing to click, but the picture stays", () => {
  const { queryAllByRole, container } = render(<AwayStrip segments={SEGMENTS} totalMs={TOTAL} />);
  expect(queryAllByRole("button")).toHaveLength(0);
  expect(container.querySelectorAll("span[title]")).toHaveLength(2);
  expect(container.textContent).toContain("looked away");
});
