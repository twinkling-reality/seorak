/**
 * terminal-list.test.ts — the LIST form (`/view list`). It is a different shape
 * for the same facts, so what needs pinning is that changing form never changes
 * the claim: an unmeasured row is absent rather than "--", a blocked session
 * still leads, and a rate's bar is drawn from the SAME number the label shows.
 */
import { describe, expect, it } from "vitest";
import { bar, renderList } from "../src/terminal/render/list.ts";
import type { LiveRow, StatRow } from "../src/terminal/narrative.ts";

const ANSI = /\x1b\[[0-9;]*m/;

const LIVE: LiveRow[] = [
  { project: "orchescope", state: "waiting on you for 9 minutes", needsYou: true },
  { project: "seorak", state: "running", needsYou: false },
];

const STATS: StatRow[] = [
  { label: "sessions", value: "81", note: "across 9 projects" },
  { label: "cost", value: "at least $4,314", note: "Claude Opus 5 has no public price yet" },
  { label: "ended in a commit", value: "75%", rate: 0.75, note: "Claude Code only" },
];

const render = (live = LIVE, stats = STATS, width = 78, color = false) =>
  renderList(live, stats, color, width, 7).join("\n");

describe("bar", () => {
  it("is always exactly the track width in visible cells", () => {
    for (const rate of [0, 0.01, 0.37, 0.5, 0.999, 1]) {
      expect([...bar(false, rate)].length, String(rate)).toBe(10);
    }
  });

  it("a REAL 0 draws the empty track; 1 fills it", () => {
    expect(bar(false, 0)).toBe("░".repeat(10));
    expect(bar(false, 1)).toBe("█".repeat(10));
  });

  it("uses eighth blocks for sub-cell resolution", () => {
    expect(bar(false, 0.75)).toBe(`${"█".repeat(7)}▌${"░".repeat(2)}`);
  });

  it("clamps out of range rather than overflowing the track", () => {
    expect([...bar(false, 5)].length).toBe(10);
    expect([...bar(false, -1)].length).toBe(10);
  });

  it("renders as plain glyphs under NO_COLOR (it is data, not decoration)", () => {
    expect(bar(false, 0.5)).not.toMatch(ANSI);
    expect(bar(true, 0.5)).toMatch(ANSI);
  });
});

describe("renderList", () => {
  it("puts the blocked session first and marks its row", () => {
    const lines = render().split("\n");
    const first = lines[lines.indexOf("now") + 1]!;
    expect(first).toContain("orchescope");
    expect(first).toContain("waiting on you for 9 minutes");
    expect(first.startsWith("▎")).toBe(true);
    expect(lines[lines.indexOf("now") + 2]!.startsWith("▎")).toBe(false);
  });

  it("speaks a sentence when nothing is live, never a blank section", () => {
    expect(render([])).toContain("Nothing is running right now.");
  });

  it("lines every value up into one column", () => {
    const lines = render().split("\n");
    const valueCol = (needle: string) => lines.find((l) => l.includes(needle))!.indexOf(needle);
    expect(valueCol("81")).toBe(valueCol("at least $4,314"));
    expect(valueCol("81")).toBe(valueCol("75%"));
  });

  it("keeps a short note on the same row and wraps a long one underneath", () => {
    const wide = render(LIVE, STATS, 100).split("\n");
    expect(wide.find((l) => l.includes("sessions"))).toContain("across 9 projects");
    const narrow = render(LIVE, STATS, 46).split("\n");
    const costLine = narrow.findIndex((l) => l.includes("at least $4,314"));
    expect(narrow[costLine]).not.toContain("no public price");
    expect(narrow.slice(costLine + 1).join(" ").replace(/\s+/g, " ")).toContain("no public price yet");
  });

  it("draws the bar from the same rate the label shows", () => {
    const line = render()
      .split("\n")
      .find((l) => l.includes("ended in a commit"))!;
    expect(line).toContain("75%");
    expect(line).toContain(`${"█".repeat(7)}▌`);
  });

  it("omits an unmeasured row entirely rather than rendering '--'", () => {
    const out = render(LIVE, [{ label: "sessions", value: "0" }]);
    expect(out).not.toContain("--");
    expect(out).not.toContain("ended in a commit");
  });

  it("drops the window section when there is nothing measured in it", () => {
    const out = render(LIVE, []);
    expect(out).not.toContain("last 7 days");
    expect(out).toContain("orchescope");
  });

  it("emits ZERO escape bytes when color is off", () => {
    expect(render(LIVE, STATS, 78, false)).not.toMatch(ANSI);
  });

  it("emits ANSI when color is on and the content survives", () => {
    const out = render(LIVE, STATS, 78, true);
    expect(out).toMatch(ANSI);
    expect(out).toContain("orchescope");
    expect(out).toContain("75%");
  });
});
