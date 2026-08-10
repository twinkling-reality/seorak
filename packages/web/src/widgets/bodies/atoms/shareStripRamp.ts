/** Fixed neutral for "+N more" tail segments on share strips. */
export const STRIP_TAIL_FILL = 'var(--viz-cat-other)';

/**
 * Validated ordinal palette for ranked share strips. Each slot is a distinct
 * hue (tokens.css --viz-seq-*), not a monochrome ink step — segments must
 * be distinguishable at a glance and under common CVD.
 */
export const VIZ_SEQ_FILLS = [
  'var(--viz-seq-1)',
  'var(--viz-seq-2)',
  'var(--viz-seq-3)',
  'var(--viz-seq-4)',
  'var(--viz-seq-5)',
  'var(--viz-seq-6)',
] as const;

/** Color for the i-th ranked segment (0 = dominant). Cycles if count > 6. */
export function vizSeqColor(index: number): string {
  return VIZ_SEQ_FILLS[index % VIZ_SEQ_FILLS.length] ?? VIZ_SEQ_FILLS[0];
}

/**
 * Live-streaming ramp — in-flight surfaces only (live session rows).
 */
export function liveRampColor(index: number, count: number): string {
  if (count <= 1) return 'var(--live)';
  const t = index / (count - 1);
  const pct = Math.round(100 - t * 60);
  return `color-mix(in srgb, var(--live) ${pct}%, var(--viz-ramp-base))`;
}
