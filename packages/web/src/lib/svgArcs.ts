// ── Arc ring constants & helpers ──
export const CX = 130;
export const CY = 130;
export const R = 58;
export const SW = 13;
export const GAP = 14;
export const DEG = Math.PI / 180;

// Leader line geometry: ring edge → radial stub → horizontal to text
export const LEADER_GAP = 5; // gap between ring outer edge and line start
export const LEADER_STUB = 20; // radial segment length
export const LEADER_H = 22; // horizontal extension from elbow to text
export const MIN_LABEL_GAP = 28; // min vertical px between labels on the same side

export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
): string {
  const s = (startDeg - 90) * DEG,
    e = (startDeg + sweepDeg - 90) * DEG;
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`;
}

/** A single arc segment: where it starts (degrees clockwise from 12 o'clock)
 *  and how far it sweeps. */
export interface ArcSlice {
  startDeg: number;
  sweepDeg: number;
}

/** Distribute `values` proportionally around 360°, leaving `gapDeg` between
 *  adjacent slices. Returns parallel `startDeg`/`sweepDeg` for each input.
 *  Gap is suppressed automatically when there's a single slice. Pass `gapDeg: 0`
 *  for a continuous ring. Zero-value entries get 0° sweep but still occupy
 *  their cursor slot, which keeps caller indexing aligned. */
export function computeArcSlices(values: number[], gapDeg = 0): ArcSlice[] {
  const total = values.reduce((s, v) => s + v, 0);
  const safeTotal = Math.max(1, total);
  const n = values.length;
  const gap = n > 1 ? gapDeg : 0;
  const available = Math.max(0, 360 - n * gap);
  const out: ArcSlice[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const sweep = (values[i] / safeTotal) * available;
    out.push({ startDeg: cursor, sweepDeg: sweep });
    cursor += sweep + gap;
  }
  return out;
}

/** Leader-line geometry for an arc: the points an SVG renderer needs to
 *  draw a connector from the ring edge to a label position. Anchor sits
 *  just outside the ring at the slice midpoint; elbow extends radially
 *  outward; label hangs horizontally past the elbow. `side` lets the
 *  caller pick text-anchor and label x-offset direction. */
export interface LeaderPoints {
  anchorX: number;
  anchorY: number;
  elbowX: number;
  elbowY: number;
  labelX: number;
  labelY: number;
  side: 'left' | 'right';
}

/** Per-arc leader-line geometry. Defaults match `lib/svgArcs.ts`'s canonical
 *  ring constants (CX/CY/R/SW/LEADER_*); override for non-canonical sizes. */
export function computeLeaderGeometry(
  arcs: ArcSlice[],
  options: {
    cx?: number;
    cy?: number;
    r?: number;
    sw?: number;
    leaderGap?: number;
    leaderStub?: number;
    leaderH?: number;
  } = {},
): LeaderPoints[] {
  const cx = options.cx ?? CX;
  const cy = options.cy ?? CY;
  const r = options.r ?? R;
  const sw = options.sw ?? SW;
  const lg = options.leaderGap ?? LEADER_GAP;
  const ls = options.leaderStub ?? LEADER_STUB;
  const lh = options.leaderH ?? LEADER_H;
  const anchorR = r + sw / 2 + lg;
  const elbowR = anchorR + ls;
  return arcs.map((arc) => {
    const midDeg = (arc.startDeg + arc.sweepDeg / 2 - 90) * DEG;
    const side: 'left' | 'right' = Math.cos(midDeg) >= 0 ? 'right' : 'left';
    const anchorX = cx + anchorR * Math.cos(midDeg);
    const anchorY = cy + anchorR * Math.sin(midDeg);
    const elbowX = cx + elbowR * Math.cos(midDeg);
    const elbowY = cy + elbowR * Math.sin(midDeg);
    return {
      anchorX,
      anchorY,
      elbowX,
      elbowY,
      labelX: side === 'right' ? elbowX + lh : elbowX - lh,
      labelY: elbowY,
      side,
    };
  });
}

/** Per-side label-collision pass. Sorts candidates by `value` desc and
 *  greedily picks labels that are at least `minGap` apart vertically on
 *  each side of the ring. Returns the set of indices that should render
 *  a label; arcs not in the set should suppress their leader+text.
 *  `exclude` lets the caller skip slices that should never claim a label
 *  (e.g. an aggregated "Other" bucket). */
export function pickLabeledArcs<
  T extends { value: number; labelY: number; side: 'left' | 'right' },
>(entries: T[], options: { minGap?: number; exclude?: (entry: T) => boolean } = {}): Set<number> {
  const minGap = options.minGap ?? MIN_LABEL_GAP;
  const exclude = options.exclude ?? (() => false);
  const labeled = new Set<number>();
  for (const side of ['left', 'right'] as const) {
    const candidates = entries
      .map((e, i) => ({ i, value: e.value, y: e.labelY, side: e.side }))
      .filter((c) => c.side === side && !exclude(entries[c.i]))
      .sort((a, b) => b.value - a.value);
    const placed: number[] = [];
    for (const { i, y } of candidates) {
      if (placed.every((py) => Math.abs(py - y) >= minGap)) {
        labeled.add(i);
        placed.push(y);
      }
    }
  }
  return labeled;
}
