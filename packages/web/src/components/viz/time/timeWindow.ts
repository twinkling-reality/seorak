// Focus-window math for time stages. Domain-free on purpose: it knows about a
// span, a window inside that span, and marks placed on it — nothing about
// replay, sessions, or projects. The replay-specific origin lives in
// views/ReplayView/replayTimeline.ts and binds these helpers to a timeline.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A view window over a timeline, in elapsed ms from the timeline origin. */
export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export function windowSpanMs(window: TimeWindow): number {
  return Math.max(1, window.endMs - window.startMs);
}

export function fullWindow(spanMs: number): TimeWindow {
  return { startMs: 0, endMs: Math.max(1, spanMs) };
}

export function isFullWindow(window: TimeWindow, spanMs: number): boolean {
  return window.startMs <= 0 && window.endMs >= Math.max(1, spanMs);
}

/** Hold a window inside the timeline without letting it collapse. */
export function clampWindow(window: TimeWindow, spanMs: number, minMs: number): TimeWindow {
  const span = Math.max(1, spanMs);
  const min = Math.min(span, Math.max(1, minMs));
  let width = Math.min(span, Math.max(min, window.endMs - window.startMs));
  if (!Number.isFinite(width) || width <= 0) width = span;
  let startMs = Math.min(Math.max(0, window.startMs), span - width);
  if (!Number.isFinite(startMs) || startMs < 0) startMs = 0;
  return { startMs, endMs: startMs + width };
}

/** Zoom around an anchor, keeping the anchor's position in the window fixed. */
export function zoomWindow(
  window: TimeWindow,
  spanMs: number,
  minMs: number,
  factor: number,
  anchorMs: number,
): TimeWindow {
  const span = Math.max(1, spanMs);
  const current = windowSpanMs(window);
  const next = Math.min(span, Math.max(Math.min(span, Math.max(1, minMs)), current * factor));
  const anchor = Math.min(Math.max(anchorMs, window.startMs), window.endMs);
  const anchorFrac = (anchor - window.startMs) / current;
  const startMs = anchor - anchorFrac * next;
  return clampWindow({ startMs, endMs: startMs + next }, span, minMs);
}

export function panWindow(
  window: TimeWindow,
  spanMs: number,
  minMs: number,
  deltaMs: number,
): TimeWindow {
  return clampWindow(
    { startMs: window.startMs + deltaMs, endMs: window.endMs + deltaMs },
    spanMs,
    minMs,
  );
}

/**
 * Page the window so a moving playhead stays visible. Playback turns pages
 * rather than scrolling continuously: the shape inside a page holds still, so
 * window-scoped normalization only rescales at a page turn instead of drifting
 * under the reader.
 */
export function pageWindowTo(
  window: TimeWindow,
  spanMs: number,
  minMs: number,
  elapsedMs: number,
): TimeWindow {
  if (elapsedMs >= window.startMs && elapsedMs <= window.endMs) return window;
  const width = windowSpanMs(window);
  const lead = width * 0.08;
  const startMs = elapsedMs > window.endMs ? elapsedMs - lead : elapsedMs - width + lead;
  return clampWindow({ startMs, endMs: startMs + width }, spanMs, minMs);
}

/** Window-relative 0..1 position for an elapsed value. */
export function windowFrac(window: TimeWindow, elapsedMs: number): number {
  return (elapsedMs - window.startMs) / windowSpanMs(window);
}

export function elapsedAtWindowFrac(window: TimeWindow, frac: number): number {
  return window.startMs + frac * windowSpanMs(window);
}

export function isInWindow(window: TimeWindow, elapsedMs: number): boolean {
  return elapsedMs >= window.startMs && elapsedMs <= window.endMs;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Elapsed clock that survives a 90-day span. An m:ss-only formatter rendered a
 * six-hour scope as "372:14".
 */
export function formatElapsedClock(elapsedMs: number, spanMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / SECOND));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  if (spanMs < HOUR) return `${Math.floor(total / 60)}:${pad(seconds)}`;
  if (spanMs < DAY) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${Math.floor(hours / 24)}d ${pad(hours % 24)}:${pad(minutes)}`;
}

export type AxisLabelKind = 'elapsed' | 'time' | 'weekday' | 'date';

/**
 * Which label the axis should carry. Past a few hours the reader wants to know
 * *when*, not how far in — an absolute stamp beats a running elapsed count.
 */
export function axisLabelKind(spanMs: number): AxisLabelKind {
  if (spanMs < 6 * HOUR) return 'elapsed';
  if (spanMs < 36 * HOUR) return 'time';
  if (spanMs < 8 * DAY) return 'weekday';
  return 'date';
}

const TICK_STEPS_MS = [
  SECOND,
  5 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

/** Round tick step for a window, so labels land on readable instants. */
export function axisTickStepMs(window: TimeWindow, targetCount = 5): number {
  const rough = windowSpanMs(window) / Math.max(1, targetCount);
  return TICK_STEPS_MS.find((step) => step >= rough) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]!;
}

export interface AxisTick {
  elapsedMs: number;
  frac: number;
}

/** Evenly spaced ticks inside the window, aligned to the round step. */
export function axisTicks(window: TimeWindow, targetCount = 5): AxisTick[] {
  const step = axisTickStepMs(window, targetCount);
  const first = Math.ceil(window.startMs / step) * step;
  const ticks: AxisTick[] = [];
  for (let at = first; at <= window.endMs; at += step) {
    ticks.push({ elapsedMs: at, frac: windowFrac(window, at) });
    if (ticks.length > 24) break;
  }
  return ticks;
}

/** A time series point: an instant plus one numeric value per series key. */
export interface WindowedPoint {
  elapsedMs: number;
  [seriesKey: string]: number;
}

function numberAt(point: WindowedPoint, key: string): number | null {
  const value = point[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Largest value inside the window across every key — the divisor a stage
 * normalizes by. Normalizing to the whole span instead lets one distant peak
 * flatten everything else to a floor-hugging line.
 */
export function windowMaxValue(
  points: WindowedPoint[],
  keys: readonly string[],
  window: TimeWindow,
): number {
  let max = 0;
  for (const point of points) {
    if (!isInWindow(window, point.elapsedMs)) continue;
    for (const key of keys) {
      const value = numberAt(point, key);
      if (value != null && value > max) max = value;
    }
  }
  return max;
}

/** Per-key peak inside the window, so a quiet series still reports its number. */
export function windowKeyPeaks(
  points: WindowedPoint[],
  keys: readonly string[],
  window: TimeWindow,
): Map<string, number> {
  const peaks = new Map<string, number>();
  for (const key of keys) peaks.set(key, 0);
  for (const point of points) {
    if (!isInWindow(window, point.elapsedMs)) continue;
    for (const key of keys) {
      const value = numberAt(point, key);
      if (value != null && value > (peaks.get(key) ?? 0)) peaks.set(key, value);
    }
  }
  return peaks;
}

export type MarkerTone = 'alert' | 'peak' | 'commit' | 'neutral';

export interface BinnableMarker {
  elapsedMs: number;
  kind: 'keyframe' | 'moment';
  tone: MarkerTone;
}

export interface MarkerBin {
  id: string;
  /** Bin center, elapsed ms. */
  elapsedMs: number;
  /** 0..1 position inside the window. */
  frac: number;
  count: number;
  attentionCount: number;
  keyframeCount: number;
  /** Highest-priority tone present in the bin. */
  tone: MarkerTone;
}

function tonePriority(tone: MarkerTone): number {
  if (tone === 'alert') return 0;
  if (tone === 'peak') return 1;
  if (tone === 'commit') return 2;
  return 3;
}

/**
 * Collapse a marker rail into fixed columns. Ungrouped, a period-scale scope
 * drew hundreds of 2px ticks as an unreadable dust cloud; a bin is still backed
 * by real markers and carries its own count, so nothing is invented or hidden.
 */
export function binMarkers(
  markers: BinnableMarker[],
  window: TimeWindow,
  binCount: number,
): MarkerBin[] {
  const bins = Math.max(1, Math.floor(binCount));
  const width = windowSpanMs(window) / bins;
  const byIndex = new Map<number, MarkerBin>();

  for (const marker of markers) {
    if (!isInWindow(window, marker.elapsedMs)) continue;
    const index = Math.min(bins - 1, Math.floor((marker.elapsedMs - window.startMs) / width));
    const center = window.startMs + (index + 0.5) * width;
    const bin =
      byIndex.get(index) ??
      ({
        id: `bin-${index}`,
        elapsedMs: center,
        frac: windowFrac(window, center),
        count: 0,
        attentionCount: 0,
        keyframeCount: 0,
        tone: 'neutral',
      } satisfies MarkerBin);
    bin.count += 1;
    if (marker.tone !== 'neutral') bin.attentionCount += 1;
    if (marker.kind === 'keyframe') bin.keyframeCount += 1;
    if (tonePriority(marker.tone) < tonePriority(bin.tone)) bin.tone = marker.tone;
    byIndex.set(index, bin);
  }

  return [...byIndex.values()].sort((a, b) => a.elapsedMs - b.elapsedMs);
}

/** Densest bin in the rail — where attention actually spiked. */
export function busiestMarkerBin(bins: MarkerBin[]): MarkerBin | null {
  let best: MarkerBin | null = null;
  for (const bin of bins) {
    if (!best || bin.attentionCount > best.attentionCount) best = bin;
    else if (bin.attentionCount === best.attentionCount && bin.count > best.count) best = bin;
  }
  return best;
}
