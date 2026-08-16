/**
 * identity.ts — PURE: the seorak identity block, the opener genre Claude Code
 * and Codex set: a rounded box carrying a
 * small peak mark, the wordmark, the locked positioning line, and three fact
 * rows that are all REAL state — watching (which agents this machine actually
 * captures), worker (the resolved host), range (the live window + its control).
 *
 * It renders only in the QUIET states (first-run, connecting, unreachable),
 * where the screen is otherwise blank; a board with real rows collapses to the
 * slim header, so identity never costs a working session a single row. The
 * mark/wordmark are identity, not claims; every fact row stays falsifiable.
 */
import { frameBoxWidth, paint } from "./format.ts";
import { boxBlock } from "./box.ts";
import type { IdentityFacts } from "../types.ts";
import { currentCollectorInvocation } from "../../invocation.ts";

export type { IdentityFacts };

/** The display host of a worker URL ("seorak-worker.example.workers.dev",
 *  "localhost:8787"); falls back to the raw string when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The peak mark (Seoraksan): a pixel triangle with true 45° slopes — quadrant
 *  blocks (▟/▙) for the edges, full blocks inside. Block Elements ONLY, never
 *  Geometric Shapes (▲): block glyphs fill their cell exactly in every
 *  monospace font, where ▲ renders double-width in some terminals and visibly
 *  breaks the apex centering. Rows are even-width (2/4/6) sharing one center. */
const MARK = ["  ▟▙  ", " ▟██▙ ", "▟████▙"];
const TAGLINE = "performance tracking for agentic development";
/** The block's border wears the accent, muted (dim cyan) so the mark stays the
 *  brightest element — the CC-banner treatment, not a neon frame. */
const BORDER_CODE = "2;36";
/** The mark's color ramp (buyer-picked "aurora"): teal → cyan → sky →
 *  periwinkle → lavender → indigo and back, laid DIAGONALLY across the
 *  pyramid's cells. The far end is anchored to the WEB'S OWN palette so the
 *  brand rhymes across surfaces: 140/146 ≈ `--accent` lavender #a896d4 (and
 *  its dark-mode #b9a8e0), 62 ≈ `--info` indigo #5d58de (app.css tokens).
 *  Green/amber stay OUT of the mark — on this surface they mean "working" and
 *  "needs you". A static render shows the gradient at phase 0 (cyan →
 *  lavender across the peak); an advancing `pulse` slides it — the
 *  quiet-state shimmer. Palindrome ordering keeps the cycle seamless. */
const RAMP = [
  "38;5;30",
  "38;5;37",
  "38;5;44",
  "38;5;51",
  "38;5;81",
  "38;5;111",
  "38;5;146",
  "38;5;140",
  "38;5;62",
  "38;5;140",
  "38;5;146",
  "38;5;111",
  "38;5;81",
  "38;5;51",
  "38;5;44",
  "38;5;37",
] as const;
/** Pulse ticks per ramp step: the shimmer timer ticks ~100ms, so 2 ticks
 *  ≈ 200ms a step — fluid, not strobing. */
const RAMP_TICKS = 2;

/** Paint the mark row with the diagonal ramp: each block cell's shade comes
 *  from (row + col + phase), spaces pass through unpainted. */
function paintMark(row: string, rowIndex: number, phase: number, color: boolean): string {
  if (!color) return row;
  let out = "";
  for (let col = 0; col < row.length; col++) {
    const ch = row[col]!;
    if (ch === " ") {
      out += ch;
    } else {
      const shade = RAMP[(rowIndex + col + Math.floor(phase / RAMP_TICKS)) % RAMP.length]!;
      out += paint(true, shade, ch);
    }
  }
  return out;
}

/** Clip a PLAIN string to `max` visible cells (values are unpainted when clipped). */
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;
}

/**
 * miniMark — the peak at header scale: the identity mark's silhouette in two
 * cells, wearing two fixed aurora anchors (cyan → the web-token lavender). This
 * is what puts identity on the WORKING board, where the full block never
 * renders (ADR-2a keeps it off screens with rows) — the header line is already
 * paid for, so identity rides it at zero row cost (BOARD-CRAFT round 2).
 * STATIC always: a working board runs no timers. Color off = plain glyphs,
 * the same reduced path the full mark takes.
 */
export function miniMark(color: boolean): string {
  return paint(color, "38;5;44", "▟") + paint(color, "38;5;146", "▙");
}

/**
 * identityBlock — PURE. The bordered block at the given terminal width. Below
 * ~56 usable cells the mark column is dropped (compact form) so narrow
 * terminals keep an intact border instead of a broken one. The mark carries a
 * diagonal color gradient; `pulse` slides it (the connecting spinner's fast
 * wave, or the settled board's slow `slowPhase` drift on natural repaints).
 * Color off = plain block glyphs, zero escapes — the reduced-motion path.
 */
export function identityBlock(
  facts: IdentityFacts,
  rangeDays: number,
  color: boolean,
  width: number,
  pulse = 0,
  message?: { label: string; body: readonly string[] },
): string[] {
  const inner = frameBoxWidth(width) - 2;
  const mark = (s: string, row: number) => paintMark(s, row, pulse, color);
  const bold = (s: string) => paint(color, "1", s);
  const dim = (s: string) => paint(color, "2", s);

  const compact = inner < 56;
  const rows: string[] = [""];

  if (compact) {
    rows.push(`  ${bold("seorak")}`);
    rows.push(`  ${dim(clip(TAGLINE, inner - 3))}`);
  } else {
    rows.push(`  ${mark(MARK[0]!, 0)}  ${bold("seorak")}`);
    rows.push(`  ${mark(MARK[1]!, 1)}  ${dim(clip(TAGLINE, inner - 12))}`);
    rows.push(`  ${mark(MARK[2]!, 2)}`);
  }
  rows.push("");

  const fact = (label: string, value: string): string =>
    `  ${dim(label.padEnd(10))}${clip(value, inner - 13)}`;
  rows.push(
    fact("watching", facts.watching ?? `nothing yet (run ${currentCollectorInvocation()} setup)`),
  );
  rows.push(fact("worker", facts.workerHost));
  rows.push(fact("range", `last ${rangeDays} days`) + (compact ? "" : ` ${dim("left/right to change")}`));

  // The message the card is on screen FOR (release notes, a setup problem). It
  // sits under the facts with its own label, so it reads as one more true thing
  // about this machine rather than as an ad pasted onto the block.
  if (message && message.body.length > 0) {
    rows.push("");
    rows.push(`  ${dim(message.label)}`);
    for (const line of message.body) rows.push(`  ${clip(line, inner - 3)}`);
  }
  rows.push("");

  return boxBlock(rows, color, inner, BORDER_CODE);
}
