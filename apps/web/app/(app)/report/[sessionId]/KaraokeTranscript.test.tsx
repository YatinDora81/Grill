import { test, expect, describe, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import type { TranscriptWord } from "@repo/types";
import { KaraokeTranscript, activeWordIndex } from "./KaraokeTranscript";

function words(...spans: [word: string, start: number, end: number][]): TranscriptWord[] {
  return spans.map(([word, start, end]) => ({ word, start, end }));
}

function layer(container: HTMLElement): HTMLElement[] {
  const host = container.querySelector("p > span[aria-hidden='true']");
  return Array.from(host?.children ?? []) as HTMLElement[];
}

function hasClass(node: HTMLElement, cls: string): boolean {
  return node.className.split(/\s+/).includes(cls);
}

function textsWith(container: HTMLElement, cls: string): (string | undefined)[] {
  return layer(container)
    .filter((n) => hasClass(n, cls))
    .map((n) => n.textContent?.trim());
}

const SENTENCE = words(
  ["So", 0, 0.3],
  ["basically", 0.3, 0.9],
  ["we", 0.9, 1.1],
  ["um", 1.4, 1.7],
  ["shipped", 1.7, 2.2],
);

describe("activeWordIndex", () => {
  test("nothing is playing, so no word is current", () => {
    expect(activeWordIndex(SENTENCE, null)).toBe(-1);
  });

  test("a time before the first word lights nothing", () => {
    expect(activeWordIndex(SENTENCE, -0.4)).toBe(-1);
  });

  test("a time exactly on a word's start lands on that word, not the one before it", () => {
    expect(activeWordIndex(SENTENCE, 0.3)).toBe(1);
    expect(activeWordIndex(SENTENCE, 1.4)).toBe(3);
  });

  test("mid-word stays on the word that started", () => {
    expect(activeWordIndex(SENTENCE, 2.0)).toBe(4);
  });

  test("inside a pause between two words the previous word stays lit", () => {
    expect(activeWordIndex(SENTENCE, 1.25)).toBe(2);
  });

  test("past the last word the last word stays lit — a null time is what clears it", () => {
    expect(activeWordIndex(SENTENCE, 9_999)).toBe(4);
  });

  test("an empty word list never indexes into nothing", () => {
    expect(activeWordIndex([], 1)).toBe(-1);
  });

  test("agrees with a linear scan at every boundary of a long clip", () => {
    const many = words(
      ...Array.from({ length: 400 }, (_, i): [string, number, number] => [
        `w${i}`,
        i * 0.4,
        i * 0.4 + 0.3,
      ]),
    );
    for (const t of [0, 0.39, 0.4, 55.5, 100.2, 159.9, 160]) {
      let expected = -1;
      many.forEach((w, i) => {
        if (w.start <= t) expected = i;
      });
      expect(activeWordIndex(many, t)).toBe(expected);
    }
  });
});

describe("filler tinting", () => {
  test("tints the shared list's fillers and leaves ordinary vocabulary alone", () => {
    const { container } = render(<KaraokeTranscript words={SENTENCE} currentTime={null} />);
    expect(textsWith(container, "text-weak")).toEqual(["um"]);
  });

  test("does not resurrect 'basically', which the server's list deliberately drops", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(["basically", 0, 0.5], ["actually", 0.5, 1], ["literally", 1, 1.5])}
        currentTime={null}
      />,
    );
    expect(textsWith(container, "text-weak")).toEqual([]);
  });

  test("normalises case and punctuation before matching", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(["Um,", 0, 0.2], ["UH!", 0.2, 0.4], ["fine", 0.4, 0.8])}
        currentTime={null}
      />,
    );
    expect(textsWith(container, "text-weak")).toEqual(["Um,", "UH!"]);
  });

  test("a two-word filler tints both of its words", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(
          ["it", 0, 0.2],
          ["was", 0.2, 0.4],
          ["you", 0.4, 0.6],
          ["know", 0.6, 0.8],
          ["late", 0.8, 1],
        )}
        currentTime={null}
      />,
    );
    expect(textsWith(container, "text-weak")).toEqual(["you", "know"]);
    expect(container.querySelector(".chip-error")?.textContent).toBe("×1 filler");
  });

  test("a literal 'like' is left alone", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(["I'd", 0, 0.2], ["like", 0.2, 0.4], ["to", 0.4, 0.6], ["ship", 0.6, 0.9])}
        currentTime={null}
      />,
    );
    expect(textsWith(container, "text-weak")).toEqual([]);
  });

  test("a hesitating 'like' is tinted", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(["and", 0, 0.2], ["like", 0.2, 0.4], ["coordination", 0.4, 1])}
        currentTime={null}
      />,
    );
    expect(textsWith(container, "text-weak")).toEqual(["like"]);
  });

  test("counts the fillers it tinted, and only those, in the chip", () => {
    const { container } = render(
      <KaraokeTranscript
        words={words(["um", 0, 0.2], ["so", 0.2, 0.4], ["uh", 0.4, 0.6], ["yeah", 0.6, 1])}
        currentTime={null}
      />,
    );
    expect(container.querySelector(".chip-error")?.textContent).toBe("×2 fillers");
  });

  test("one filler is singular", () => {
    const { container } = render(
      <KaraokeTranscript words={words(["um", 0, 0.2], ["yeah", 0.2, 1])} currentTime={null} />,
    );
    expect(container.querySelector(".chip-error")?.textContent).toBe("×1 filler");
  });

  test("no fillers means no chip", () => {
    const { container } = render(
      <KaraokeTranscript words={words(["clean", 0, 0.4], ["answer", 0.4, 1])} currentTime={null} />,
    );
    expect(container.querySelector(".chip-error")).toBeNull();
  });

  test("a filler is still tinted while it is the current word", () => {
    const { container } = render(<KaraokeTranscript words={SENTENCE} currentTime={1.5} />);
    const um = layer(container)[3]!;
    expect(hasClass(um, "text-weak")).toBe(true);
    expect(hasClass(um, "bg-ember-soft")).toBe(true);
  });
});

describe("rendering", () => {
  test("the whole answer is one readable sentence for a screen reader", () => {
    const { container } = render(<KaraokeTranscript words={SENTENCE} currentTime={null} />);
    expect(container.querySelector(".sr-only")?.textContent).toBe("“So basically we um shipped”");
  });

  test("with no audio there are no controls, and nothing reads as upcoming", () => {
    const { container } = render(<KaraokeTranscript words={SENTENCE} currentTime={null} />);
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(textsWith(container, "text-ink-muted")).toEqual([]);
  });

  test("while playing, spoken / current / upcoming are three different states", () => {
    const { container } = render(<KaraokeTranscript words={SENTENCE} currentTime={1.0} />);
    const nodes = layer(container);
    expect(hasClass(nodes[0]!, "text-ink")).toBe(true);
    expect(hasClass(nodes[2]!, "bg-ember-soft")).toBe(true);
    expect(hasClass(nodes[4]!, "text-ink-muted")).toBe(true);
  });

  test("a word click seeks to that word's own start", () => {
    const onSeek = mock((_: number) => {});
    const { container } = render(
      <KaraokeTranscript words={SENTENCE} currentTime={null} onSeek={onSeek} />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(SENTENCE.length);
    fireEvent.click(buttons[3]!);
    expect(onSeek).toHaveBeenCalledWith(1.4);
  });

  test("the word layer adds no tab stops and announces nothing", () => {
    const { container } = render(
      <KaraokeTranscript words={SENTENCE} currentTime={null} onSeek={() => {}} />,
    );
    for (const b of container.querySelectorAll("button")) {
      expect(b.getAttribute("tabindex")).toBe("-1");
    }
    expect(container.querySelector("p > span[aria-hidden='true']")).not.toBeNull();
  });
});
