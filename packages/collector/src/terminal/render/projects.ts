/**
 * projects.ts (PURE). Every project in the window, side by side (`/view projects`).
 *
 * THE ONE PLACE "--" COMES BACK, and it is worth saying why. The paragraph and
 * the list can decline to make a claim: an unmeasured leg simply is not written.
 * A table cannot, because a row has a cell under every column whether or not
 * there is a number for it. So the honest-empty gate changes SHAPE here rather
 * than being dropped: the cell renders a DIM "--", never a zero, never a blank
 * that reads as measured. This is the treatment BOARD-CRAFT ADR-3 settled on for
 * exactly this situation, and the rule it enforces is unchanged: an absence must
 * not be able to be mistaken for a measurement.
 *
 * Columns drop from the right as the terminal narrows, so a narrow window loses
 * detail rather than alignment.
 */
import { paint, padEndVisible, visibleWidth } from "./format.ts";
import { fmtCount, magnitude, usdPhrase } from "../voice.ts";
import type { ProjectTableRow } from "../narrative.ts";

/** Below this the cost and survival columns are dropped; below the second, the
 *  ship-rate column goes too. Chosen so the PROJECT column never falls under a
 *  readable width rather than to hit a round number. */
const WIDE = 74;
const MEDIUM = 58;

interface Column {
  head: string;
  width: number;
  /** The cell text, or null for an honest-empty (rendered as a dim "--"). */
  cell: (r: ProjectTableRow) => string | null;
}

const SESSIONS: Column = { head: "SESSIONS", width: 8, cell: (r) => fmtCount(r.sessions) };
const TOKENS: Column = { head: "TOKENS", width: 8, cell: (r) => (r.tokens > 0 ? magnitude(r.tokens) : null) };
const COST: Column = {
  head: "COST",
  width: 10,
  // A floor is marked with a trailing "+" rather than printed as if exact: this
  // project ran a model with no public price, so the number is a lower bound.
  // ASCII on purpose. "≥" is Mathematical Operators, the same font-fallback trap
  // as the arrow glyphs, and it would render at a different size than the digits
  // beside it in most terminals.
  cell: (r) => (r.costUsd === null ? null : `${usdPhrase(r.costUsd)}${r.costIsFloor ? "+" : ""}`),
};
const SHIPPED: Column = {
  head: "SHIPPED",
  width: 7,
  cell: (r) => (r.shipRate === null ? null : `${Math.round(r.shipRate * 100)}%`),
};
const LINES: Column = {
  head: "LINES",
  width: 6,
  cell: (r) => (r.survival === null ? null : `${Math.round(r.survival * 100)}%`),
};

function columnsFor(width: number): Column[] {
  if (width >= WIDE) return [SESSIONS, TOKENS, COST, SHIPPED, LINES];
  if (width >= MEDIUM) return [SESSIONS, TOKENS, SHIPPED];
  return [SESSIONS, TOKENS];
}

/** Right-align within a column (numbers read down a column by their last digit). */
function padStartVisible(s: string, width: number): string {
  const gap = width - visibleWidth(s);
  return gap > 0 ? " ".repeat(gap) + s : s;
}

/**
 * renderProjects (PURE). The table, plus a line naming anything the cap dropped.
 * `focusedRepoId` marks the row the board is currently focused on, so arrowing
 * through projects and reading the table are visibly the same act.
 */
export function renderProjects(
  table: { rows: readonly ProjectTableRow[]; total: number },
  color: boolean,
  width: number,
  days: number,
  focusedRepoId?: string,
): string[] {
  const dim = (s: string) => paint(color, "2", s);
  const empty = dim("--");

  if (table.rows.length === 0) {
    return [dim(`last ${days} days`), "  No projects in this window yet."];
  }

  const cols = columnsFor(width);
  const fixed = cols.reduce((n, c) => n + c.width + 2, 0);
  const nameCol = Math.max(12, Math.min(28, width - fixed - 2));

  const out: string[] = [dim(`last ${days} days`)];
  out.push(
    `  ${dim(padEndVisible("PROJECT", nameCol))}${cols.map((c) => dim(padStartVisible(c.head, c.width)) + "  ").join("")}`.trimEnd(),
  );

  for (const row of table.rows) {
    const focused = row.repoId === focusedRepoId;
    const marker = focused ? paint(color, "1;36", "▎") : " ";
    const name = focused ? paint(color, "1", row.project) : row.project;
    const cells = cols
      .map((c) => {
        const v = c.cell(row);
        return (v === null ? padStartVisible(empty, c.width) : padStartVisible(v, c.width)) + "  ";
      })
      .join("");
    out.push(`${marker} ${padEndVisible(name, nameCol)}${cells}`.trimEnd());
  }

  // The "+" has to be explained where it is used, or it is just a number with a
  // typo. Only shown when a row actually wears one.
  if (cols.includes(COST) && table.rows.some((r) => r.costIsFloor && r.costUsd !== null)) {
    out.push(dim("  A cost with a + ran a model that has no public price, so it is a floor."));
  }

  // Never a silent cap: a truncated list that says nothing reads as the whole
  // set, which is the same lie as a zero-filled rate wearing a real number.
  if (table.total > table.rows.length) {
    out.push(dim(`  ${table.rows.length} of ${table.total} projects, busiest first. The rest are in the dashboard.`));
  }
  return out;
}
