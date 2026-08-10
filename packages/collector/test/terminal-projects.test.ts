/**
 * terminal-projects.test.ts, the all-projects table (`/view projects`).
 *
 * A table is the one form on this surface that cannot decline to make a claim:
 * every row has a cell under every column. So the honest-empty gate changes
 * shape rather than disappearing, and that is most of what is pinned here: an
 * unmeasured cell renders a dim "--", never a 0, never a blank; a cost that is
 * only a floor is marked as one; and a capped list says what it dropped.
 */
import { describe, expect, it } from "vitest";
import { renderProjects } from "../src/terminal/render/projects.ts";
import type { ProjectTableRow } from "../src/terminal/narrative.ts";

const ANSI = /\x1b\[[0-9;]*m/;

function mkRow(over: Partial<ProjectTableRow> & { project: string; repoId: string }): ProjectTableRow {
  return {
    sessions: 10,
    tokens: 5_000_000,
    costUsd: 100,
    costIsFloor: false,
    shipRate: 0.5,
    survival: 0.6,
    ...over,
  };
}

const ROWS: ProjectTableRow[] = [
  mkRow({ repoId: "r1", project: "seorak", sessions: 93, tokens: 59_800_000, costUsd: 6949, costIsFloor: true, shipRate: 0.6, survival: 0.71 }),
  mkRow({ repoId: "r2", project: "halowake", sessions: 16, tokens: 9_800_000, costUsd: 819, shipRate: 0.54, survival: 0.28 }),
  mkRow({ repoId: "r3", project: "riverbend", sessions: 8, tokens: 2_400_000, costUsd: 141, costIsFloor: true, shipRate: null, survival: null }),
];

const render = (rows = ROWS, total = rows.length, width = 78, color = false, focus?: string) =>
  renderProjects({ rows, total }, color, width, 30, focus).join("\n");

describe("renderProjects", () => {
  it("lists projects with a header row", () => {
    const out = render();
    expect(out).toContain("PROJECT");
    expect(out).toContain("SESSIONS");
    expect(out).toContain("seorak");
    expect(out).toContain("93");
  });

  it("renders an unmeasured cell as a dim '--', never 0% and never blank", () => {
    const line = render().split("\n").find((l) => l.includes("riverbend"))!;
    expect(line).toContain("--");
    expect(line).not.toContain("0%");
    // the columns still line up: an absence occupies its cell
    const measured = render().split("\n").find((l) => l.includes("halowake"))!;
    expect(line.indexOf("--")).toBeGreaterThan(0);
    expect(measured.length).toBe(line.length);
  });

  it("marks a cost that is only a floor rather than printing it as exact", () => {
    const lines = render().split("\n");
    expect(lines.find((l) => l.includes("seorak"))).toContain("$6,949+");
    expect(lines.find((l) => l.includes("halowake"))).toContain("$819");
    expect(lines.find((l) => l.includes("halowake"))).not.toContain("+");
  });

  it("explains the + where it is used, and only when a row wears one", () => {
    expect(render()).toContain("A cost with a + ran a model that has no public price");
    const priced = ROWS.map((r) => ({ ...r, costIsFloor: false }));
    expect(render(priced, 3)).not.toContain("has no public price");
  });

  it("uses ASCII for the floor marker, not a math glyph that font-falls-back", () => {
    expect(render()).not.toContain("≥");
  });

  it("NEVER caps silently: a truncated list says what it dropped", () => {
    expect(render(ROWS, 21)).toContain("3 of 21 projects, busiest first.");
    expect(render(ROWS, 3)).not.toContain("of 3 projects");
  });

  it("marks the focused row, so arrowing and reading the table are one act", () => {
    const line = render(ROWS, 3, 78, false, "r2").split("\n").find((l) => l.includes("halowake"))!;
    expect(line.startsWith("▎")).toBe(true);
    const other = render(ROWS, 3, 78, false, "r2").split("\n").find((l) => l.includes("seorak"))!;
    expect(other.startsWith("▎")).toBe(false);
  });

  it("drops columns from the right as the terminal narrows, keeping alignment", () => {
    const wide = render(ROWS, 3, 90);
    expect(wide).toContain("COST");
    expect(wide).toContain("LINES");
    const medium = render(ROWS, 3, 62);
    expect(medium).toContain("SHIPPED");
    expect(medium).not.toContain("COST");
    const narrow = render(ROWS, 3, 44);
    expect(narrow).toContain("TOKENS");
    expect(narrow).not.toContain("SHIPPED");
  });

  it("speaks a sentence when the window holds no projects", () => {
    expect(render([], 0)).toContain("No projects in this window yet.");
  });

  it("emits ZERO escape bytes when color is off", () => {
    expect(render(ROWS, 21, 78, false, "r1")).not.toMatch(ANSI);
  });

  it("emits ANSI when color is on and the content survives", () => {
    const out = render(ROWS, 21, 78, true, "r1");
    expect(out).toMatch(ANSI);
    expect(out).toContain("seorak");
    expect(out).toContain("93");
  });
});
