import { test, expect, describe } from "bun:test";
import { render } from "@testing-library/react";
import type { DeliveryPoint } from "@repo/types";
import {
  DeliverySpark,
  PACE_BAND,
  PACE_DOMAIN,
  PLOT,
  buildSpark,
  deltaOf,
  fillerDomain,
  toSegments,
  xOf,
  yOf,
} from "./DeliverySpark";

/**
 * Queries come from `render()`, never `screen`: test/setup.ts imports
 * @testing-library/react before registering happy-dom, so `screen` is bound to a
 * document that doesn't exist yet and throws on every query.
 */

let seq = 0;
function point(wpm: number | null, fillers: number | null): DeliveryPoint {
  seq += 1;
  return { session_id: `s-${seq}`, date: "2026-08-01", wpm, fillers };
}

function series(pairs: [number | null, number | null][]): DeliveryPoint[] {
  return pairs.map(([w, f]) => point(w, f));
}

const PACE = PACE_DOMAIN;

describe("pinned pace domain", () => {
  test("the floor and ceiling are the plot box, not the data", () => {
    expect(yOf(PACE[0], PACE)).toBe(PLOT.BASE);
    expect(yOf(PACE[1], PACE)).toBe(PLOT.TOP);
  });

  test("values outside the band clamp instead of stretching it", () => {
    expect(yOf(40, PACE)).toBe(yOf(PACE[0], PACE));
    expect(yOf(260, PACE)).toBe(yOf(PACE[1], PACE));
  });

  test("a wobble stays a wobble", () => {
    // The whole reason the domain is pinned: 148 → 152 must not read as a climb.
    // An auto-fit domain would put those two at BASE and TOP — the full plot.
    const wobble = Math.abs(yOf(148, PACE) - yOf(152, PACE));
    expect(wobble).toBeLessThan((PLOT.BASE - PLOT.TOP) * 0.2);
  });

  test("the domain does not move when the data does", () => {
    const calm = buildSpark(
      "pace",
      series([
        [148, 1],
        [152, 1],
      ]),
    )!;
    const wild = buildSpark(
      "pace",
      series([
        [95, 1],
        [240, 1],
      ]),
    )!;
    expect(calm.domain).toEqual(PACE);
    expect(wild.domain).toEqual(PACE);
  });

  test("the conversational band sits inside the plot box", () => {
    expect(yOf(PACE_BAND[1], PACE)).toBeGreaterThanOrEqual(PLOT.TOP);
    expect(yOf(PACE_BAND[0], PACE)).toBeLessThanOrEqual(PLOT.BASE);
    expect(yOf(PACE_BAND[1], PACE)).toBeLessThan(yOf(PACE_BAND[0], PACE));
  });
});

describe("filler domain", () => {
  test("never smaller than the floor, so three fillers can't fill the card", () => {
    expect(fillerDomain([0, 1, 2])).toEqual([0, 6]);
    expect(fillerDomain([null, null])).toEqual([0, 6]);
  });

  test("grows past the floor rather than clipping a bad session", () => {
    expect(fillerDomain([2, 14, 5])).toEqual([0, 14]);
  });

  test("always starts at zero", () => {
    const d = fillerDomain([9, 11]);
    expect(d[0]).toBe(0);
    expect(yOf(0, d)).toBe(PLOT.BASE);
  });

  test("a fractional maximum rounds up to a whole count", () => {
    expect(fillerDomain([7.2])).toEqual([0, 8]);
  });
});

describe("null values are gaps, never zeroes", () => {
  const domain = fillerDomain([4, 3, null, 2, 1]);

  test("an interior null splits the run in two", () => {
    const runs = toSegments([4, 3, null, 2, 1], domain);
    expect(runs.length).toBe(2);
    expect(runs[0]!.length).toBe(2);
    expect(runs[1]!.length).toBe(2);
  });

  test("nothing is plotted for the missing session", () => {
    const runs = toSegments([4, 3, null, 2, 1], domain);
    const plotted = runs.flat();
    expect(plotted.length).toBe(4);
    // The gap's x slot is left empty — the line breaks across it rather than
    // dipping to the baseline and back.
    const gapX = xOf(2, 5);
    expect(plotted.some(([x]) => x === gapX)).toBe(false);
    expect(plotted.some(([, y]) => y === yOf(0, domain))).toBe(false);
  });

  test("leading and trailing nulls do not create empty runs", () => {
    expect(toSegments([null, 1, 2, null], domain).length).toBe(1);
    expect(toSegments([null, null], domain).length).toBe(0);
  });

  test("the x axis keeps the missing session's slot, so the gap is visible", () => {
    const runs = toSegments([4, 3, null, 2, 1], domain);
    expect(runs[0]![1]![0]).toBe(xOf(1, 5));
    expect(runs[1]![0]![0]).toBe(xOf(3, 5));
  });

  test("rendered: an interior null produces two polylines, not one", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [150, 9],
          [148, 7],
          [null, null],
          [146, 4],
          [145, 3],
        ])}
      />,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
    for (const svg of svgs) {
      expect(svg.querySelectorAll("polyline").length).toBe(2);
    }
  });

  test("rendered: the gap is described in the accessible sentence", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [150, 9],
          [null, null],
          [146, 4],
        ])}
      />,
    );
    const label = container.querySelector("svg")!.getAttribute("aria-label")!;
    expect(label).toContain("One session carries no measurement");
    // Three sessions, two readings — the unmeasured one is never spoken as a
    // zero, and never inflates the count the sentence claims to describe.
    expect(label).toContain("2 measured sessions, oldest to newest: 150, 146.");
  });

  test("a gap does not drag the latest reading backwards", () => {
    const model = buildSpark(
      "fillers",
      series([
        [150, 9],
        [148, 4],
        [null, null],
      ]),
    )!;
    expect(model.last.value).toBe(4);
    expect(model.gaps).toBe(1);
    expect(model.measured).toBe(2);
  });
});

describe("delta direction, not sign", () => {
  test("fewer fillers is an improvement even though the number fell", () => {
    const d = deltaOf("fillers", 9, 5);
    expect(d.improving).toBe(true);
    expect(d.rising).toBe(false);
    expect(d.magnitude).toBe(4);
    expect(d.word).toBe("fewer");
  });

  test("more fillers is a regression even though the number rose", () => {
    const d = deltaOf("fillers", 3, 7);
    expect(d.improving).toBe(false);
    expect(d.rising).toBe(true);
  });

  test("level fillers are neither", () => {
    expect(deltaOf("fillers", 4, 4).improving).toBe(null);
    expect(deltaOf("fillers", 4, 4).magnitude).toBe(0);
  });

  test("pace improves by moving toward the conversational band, from either side", () => {
    expect(deltaOf("pace", 190, 165).improving).toBe(true);
    expect(deltaOf("pace", 95, 115).improving).toBe(true);
    expect(deltaOf("pace", 150, 195).improving).toBe(false);
    expect(deltaOf("pace", 115, 95).improving).toBe(false);
  });

  test("pace inside the band stays good however it moves within it", () => {
    const d = deltaOf("pace", 125, 155);
    expect(d.improving).toBe(true);
    expect(d.word).toBe("on pace");
  });

  test("rendered: a fall in fillers is toned as an improvement", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [148, 9],
          [147, 5],
        ])}
      />,
    );
    const chips = [...container.querySelectorAll("p span")].map((n) => n.className);
    expect(chips.some((c) => c.includes("text-strong"))).toBe(true);
    expect(chips.some((c) => c.includes("text-weak"))).toBe(false);
  });

  test("rendered: a rise in fillers is toned as a regression", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [148, 2],
          [147, 8],
        ])}
      />,
    );
    const chips = [...container.querySelectorAll("p span")].map((n) => n.className);
    expect(chips.some((c) => c.includes("text-weak"))).toBe(true);
  });

  test("the delta is measured against the previous MEASURED session", () => {
    const model = buildSpark(
      "fillers",
      series([
        [150, 9],
        [null, null],
        [148, 5],
      ]),
    )!;
    expect(model.delta.magnitude).toBe(4);
    expect(model.delta.improving).toBe(true);
  });
});

describe("one score is not a trend", () => {
  test("a single measured point builds no model", () => {
    expect(buildSpark("pace", series([[148, 3]]))).toBe(null);
    expect(buildSpark("pace", [])).toBe(null);
  });

  test("a series of one renders nothing at all", () => {
    const { container } = render(<DeliverySpark series={series([[148, 3]])} />);
    expect(container.innerHTML).toBe("");
  });

  test("a series where every metric is missing renders nothing", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [null, null],
          [null, null],
          [null, null],
        ])}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("one metric can qualify while the other does not", () => {
    const rows = series([
      [148, 4],
      [151, null],
      [149, null],
    ]);
    expect(buildSpark("pace", rows)).not.toBe(null);
    expect(buildSpark("fillers", rows)).toBe(null);

    const { container } = render(<DeliverySpark series={rows} />);
    expect(container.querySelectorAll("svg").length).toBe(1);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toContain(
      "Words per minute",
    );
  });
});

describe("the lit point carries its number", () => {
  test("the latest reading is printed, not only coloured", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [171, 9],
          [148, 3],
        ])}
      />,
    );
    expect(container.textContent).toContain("148");
    expect(container.textContent).toContain("×3");
  });

  test("the accessible sentence names every reading in order", () => {
    const { container } = render(
      <DeliverySpark
        series={series([
          [171, 9],
          [160, 6],
          [148, 3],
        ])}
      />,
    );
    const label = container.querySelector("svg")!.getAttribute("aria-label")!;
    expect(label).toContain("171, 160, 148");
    expect(label).toContain("Latest 148 words per minute");
    expect(label).toContain("down 12 on the session before");
  });
});
