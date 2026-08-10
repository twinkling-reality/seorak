// Deterministic pseudo-random helpers for demo data. Same inputs always
// produce the same outputs so re-renders are stable, snapshot tests don't
// drift, and scenario layouts are predictable between reloads.

export function hash(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Integer in [base - spread, base + spread], clamped to >= min (default 0).
export function wobble(seed: number, base: number, spread: number, min = 0): number {
  const frac = hash(seed);
  return Math.max(min, Math.round(base + (frac - 0.5) * 2 * spread));
}

// Allocate `total` across the proportional `shares` so the integer sum
// equals `total` exactly. Uses largest-remainder (Hamilton) so rounding
// errors go to the share with the biggest fractional remainder, not
// whichever tool happens to be first in the list.
export function allocateIntegerShares(total: number, shares: number[]): number[] {
  if (total === 0) return shares.map(() => 0);
  const sumShares = shares.reduce((s, v) => s + v, 0) || 1;
  const raw = shares.map((s) => (s / sumShares) * total);
  const floors = raw.map((r) => Math.floor(r));
  const remainder = total - floors.reduce((s, v) => s + v, 0);
  const remainders = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; k < remainder; k++) {
    floors[remainders[k % remainders.length].i] += 1;
  }
  return floors;
}

// ISO day string `n` days ago (UTC). Dates are deterministic per browser
// day so the demo's sparkline x-axis matches "today" when the user opens
// the dashboard.
export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Build the period's ISO-day spine, oldest → newest. Consumers iterate
// this once and reference i as the deterministic seed axis.
export function buildDaySpine(periodDays: number): string[] {
  const out: string[] = [];
  for (let i = periodDays - 1; i >= 0; i--) out.push(daysAgo(i));
  return out;
}

// Day-of-week weight: weekdays carry 1.0, weekends 0.35. Used as the
// session-volume shape across the 30-day window so the heatmap and
// sparklines have a recognizable weekly rhythm.
export function weekdayWeight(isoDay: string): number {
  const dow = new Date(isoDay).getUTCDay();
  return dow >= 1 && dow <= 5 ? 1.0 : 0.35;
}
