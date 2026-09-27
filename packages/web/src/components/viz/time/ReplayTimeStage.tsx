import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import clsx from 'clsx';

import {
  axisTicks,
  binMarkers,
  clampWindow,
  elapsedAtWindowFrac,
  isFullWindow,
  panWindow,
  windowFrac,
  windowKeyPeaks,
  windowMaxValue,
  windowSpanMs,
  zoomWindow,
  type MarkerBin,
  type TimeWindow,
} from './timeWindow.js';
import styles from './ReplayTimeStage.module.css';

const SVG_WIDTH = 1000;
const LINES_SVG_HEIGHT = 200;
const PLOT_PAD_TOP = 8;
const PLOT_PAD_BOTTOM = 6;
const LANE_SVG_HEIGHT = 28;
/** Coordinates outside the window are kept finite so the line enters the frame. */
const X_CLAMP = 4000;
const GRID_TICKS = [0, 50, 100] as const;
/** Tooltip rows before "+N more". */
const HOVER_CARD_MAX = 5;
/** Dots drawn on lines at hover; keeps dense drill-down readable. */
const HOVER_DOT_MAX = 8;
/** Target width of one marker-rail column, in px. */
const MARKER_BIN_PX = 9;
/** Minimum readable lane height. Past this the lane column scrolls. */
const LANE_MIN_HEIGHT = 26;
const STRIP_HEIGHT = 34;

export type ReplayTimeStagePoint = {
  elapsedMs: number;
  [seriesKey: string]: number;
};

export type ReplayTimeStageSeries = {
  key: string;
  label: string;
  color: string;
};

export type ReplayTimeStageMarker = {
  id: string;
  elapsedMs: number;
  kind: 'keyframe' | 'moment';
  tone: 'alert' | 'peak' | 'commit' | 'neutral';
};

export type ReplayStageRenderMode = 'lines' | 'lanes';

type HoverPoint = {
  key: string;
  label: string;
  color: string;
  value: number;
  /** 0..1 height inside this series' own drawing band. */
  height: number;
};

type HoverInspect = {
  elapsedMs: number;
  frac: number;
  points: HoverPoint[];
  bin: MarkerBin | null;
};

type StripDrag =
  | { mode: 'pan'; anchorMs: number; startMs: number }
  | { mode: 'brush'; anchorMs: number; currentMs: number };

export interface ReplayTimeStageProps {
  chartData: ReplayTimeStagePoint[];
  series: ReplayTimeStageSeries[];
  markers: ReplayTimeStageMarker[];
  /** Full scope length in ms; the strip always shows all of it. */
  scopeSpanMs: number;
  /** A gap wider than this reads as absence and breaks the line. */
  gapMs: number;
  /** Smallest focus window the reader is allowed to zoom to. */
  minWindowMs: number;
  /** Focus window, in scope-relative elapsed ms. */
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  renderMode: ReplayStageRenderMode;
  /** Playhead, in scope-relative elapsed ms. */
  playheadMs: number;
  onPlayheadChange: (elapsedMs: number) => void;
  /** Axis / hover label for one elapsed value. */
  formatAxis: (elapsedMs: number) => string;
  /** Human length of a span, for the focus-window status line. */
  formatSpan: (ms: number) => string;
  ariaLabel?: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function valueFor(point: ReplayTimeStagePoint, key: string): number | null {
  const value = point[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Nearest bucket value for one series at a hover time. `maxDistanceMs` is not
 * optional in spirit: without a ceiling the card confidently reported a value
 * from a bucket hours away from the cursor.
 */
export function nearestSeriesValueAt(
  points: ReplayTimeStagePoint[],
  seriesKey: string,
  elapsedMs: number,
  maxDistanceMs = Number.POSITIVE_INFINITY,
): number | null {
  let bestPoint: ReplayTimeStagePoint | null = null;
  for (const point of points) {
    if (valueFor(point, seriesKey) == null) continue;
    if (
      !bestPoint ||
      Math.abs(point.elapsedMs - elapsedMs) < Math.abs(bestPoint.elapsedMs - elapsedMs)
    ) {
      bestPoint = point;
    }
  }
  if (!bestPoint) return null;
  if (Math.abs(bestPoint.elapsedMs - elapsedMs) > maxDistanceMs) return null;
  return valueFor(bestPoint, seriesKey);
}

type Segment = Array<readonly [number, number]>;

/**
 * Contiguous runs of one series. Activity buckets are contiguous inside a
 * session (a quiet bucket is a real zero), so a gap wider than one bucket means
 * no session was running — drawing a line across it would invent activity.
 */
export function seriesSegments(
  points: ReplayTimeStagePoint[],
  key: string,
  gapMs: number,
): Segment[] {
  const segments: Segment[] = [];
  let current: Array<readonly [number, number]> = [];
  let previousMs: number | null = null;

  for (const point of points) {
    const value = valueFor(point, key);
    if (value == null) continue;
    if (previousMs != null && point.elapsedMs - previousMs > gapMs) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push([point.elapsedMs, value] as const);
    previousMs = point.elapsedMs;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function xFor(elapsedMs: number, window: TimeWindow): number {
  return clamp(windowFrac(window, elapsedMs) * SVG_WIDTH, -X_CLAMP, X_CLAMP);
}

function segmentsToLine(
  segments: Segment[],
  window: TimeWindow,
  yFor: (value: number) => number,
): string {
  return segments
    .map((segment) => {
      if (segment.length === 1) {
        const [ms, value] = segment[0]!;
        const x = xFor(ms, window);
        return `M ${x.toFixed(2)} ${yFor(value).toFixed(2)} L ${(x + 0.1).toFixed(2)} ${yFor(value).toFixed(2)}`;
      }
      return segment
        .map(([ms, value], index) => `${index === 0 ? 'M' : 'L'} ${xFor(ms, window).toFixed(2)} ${yFor(value).toFixed(2)}`)
        .join(' ');
    })
    .filter(Boolean)
    .join(' ');
}

function segmentsToArea(
  segments: Segment[],
  window: TimeWindow,
  yFor: (value: number) => number,
  baseline: number,
): string {
  return segments
    .map((segment) => {
      if (segment.length === 0) return '';
      const first = xFor(segment[0]![0], window);
      const last = xFor(segment[segment.length - 1]![0], window);
      const body = segment
        .map(([ms, value], index) => `${index === 0 ? 'M' : 'L'} ${xFor(ms, window).toFixed(2)} ${yFor(value).toFixed(2)}`)
        .join(' ');
      return `${body} L ${last.toFixed(2)} ${baseline.toFixed(2)} L ${first.toFixed(2)} ${baseline.toFixed(2)} Z`;
    })
    .filter(Boolean)
    .join(' ');
}

function markerToneClass(tone: MarkerBin['tone']): string {
  if (tone === 'alert') return styles.binAlert!;
  if (tone === 'peak') return styles.binPeak!;
  if (tone === 'commit') return styles.binCommit!;
  return styles.binNeutral!;
}

/** Element width in px, so the marker rail can pick an honest bin count. */
function useMeasuredWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(node.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export default function ReplayTimeStage({
  chartData,
  series,
  markers,
  scopeSpanMs: rawScopeSpanMs,
  gapMs,
  minWindowMs,
  window: viewWindow,
  onWindowChange,
  renderMode,
  playheadMs,
  onPlayheadChange,
  formatAxis,
  formatSpan,
  ariaLabel = 'Replay timeline',
}: ReplayTimeStageProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<StripDrag | null>(null);
  const [hoverInspect, setHoverInspect] = useState<HoverInspect | null>(null);
  const [brushPreview, setBrushPreview] = useState<TimeWindow | null>(null);
  const plotWidth = useMeasuredWidth(plotRef);

  const scopeSpanMs = Math.max(1, rawScopeSpanMs);
  const spanMs = windowSpanMs(viewWindow);
  const fullView = isFullWindow(viewWindow, scopeSpanMs);

  const seriesKeys = useMemo(() => series.map((item) => item.key), [series]);

  /**
   * Normalized to the window, not to the whole scope. One peak-burn bucket used
   * to divide every other series down to a floor-hugging line; rescaling to
   * what is on screen makes zooming into a quiet stretch actually pay off.
   */
  const windowMax = useMemo(
    () => windowMaxValue(chartData, seriesKeys, viewWindow),
    [chartData, seriesKeys, viewWindow],
  );
  const seriesPeaks = useMemo(
    () => windowKeyPeaks(chartData, seriesKeys, viewWindow),
    [chartData, seriesKeys, viewWindow],
  );

  const heightFor = useCallback(
    (value: number) => (windowMax <= 0 ? 0 : clamp(value / windowMax, 0, 1)),
    [windowMax],
  );

  const segmentsBySeries = useMemo(() => {
    const map = new Map<string, Segment[]>();
    for (const item of series) map.set(item.key, seriesSegments(chartData, item.key, gapMs));
    return map;
  }, [chartData, series, gapMs]);

  const binCount = Math.max(12, Math.round((plotWidth || 900) / MARKER_BIN_PX));
  const markerBins = useMemo(
    () => binMarkers(markers, viewWindow, binCount),
    [markers, viewWindow, binCount],
  );
  const binPeak = useMemo(
    () => markerBins.reduce((max, bin) => Math.max(max, bin.count), 0),
    [markerBins],
  );

  const stripAggregate = useMemo(() => {
    const totals: ReplayTimeStagePoint[] = chartData.map((point) => {
      let total = 0;
      for (const item of series) {
        const value = valueFor(point, item.key);
        if (value != null) total += value;
      }
      return { elapsedMs: point.elapsedMs, total };
    });
    const max = totals.reduce((best, point) => Math.max(best, point.total ?? 0), 0);
    return { totals, max };
  }, [chartData, series]);

  const stripMarkerBins = useMemo(
    () => binMarkers(markers, { startMs: 0, endMs: scopeSpanMs }, 120),
    [markers, scopeSpanMs],
  );
  const stripBinPeak = useMemo(
    () => stripMarkerBins.reduce((max, bin) => Math.max(max, bin.attentionCount), 0),
    [stripMarkerBins],
  );


  const setPlayheadFromClientX = useCallback(
    (clientX: number) => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
      onPlayheadChange(elapsedAtWindowFrac(viewWindow, frac));
    },
    [onPlayheadChange, viewWindow],
  );

  const setHoverFromClientX = useCallback(
    (clientX: number) => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
      const elapsedMs = elapsedAtWindowFrac(viewWindow, frac);
      const points = series
        .map((item): HoverPoint | null => {
          const value = nearestSeriesValueAt(chartData, item.key, elapsedMs, gapMs);
          if (value == null) return null;
          return {
            key: item.key,
            label: item.label,
            color: item.color,
            value,
            height: heightFor(value),
          };
        })
        .filter((item): item is HoverPoint => item != null)
        .sort((a, b) => b.value - a.value);

      const binWidth = spanMs / binCount;
      const bin =
        markerBins.find((candidate) => Math.abs(candidate.elapsedMs - elapsedMs) <= binWidth) ?? null;

      setHoverInspect({ elapsedMs, frac, points, bin });
    },
    [chartData, series, viewWindow, gapMs, heightFor, markerBins, spanMs, binCount],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHoverFromClientX(event.clientX);
    setPlayheadFromClientX(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    setHoverFromClientX(event.clientX);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      setPlayheadFromClientX(event.clientX);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) setHoverInspect(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = spanMs / (event.shiftKey ? 8 : 40);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onPlayheadChange(Math.max(0, playheadMs - step));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onPlayheadChange(Math.min(scopeSpanMs, playheadMs + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onPlayheadChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onPlayheadChange(scopeSpanMs);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      onWindowChange(zoomWindow(viewWindow, scopeSpanMs, minWindowMs, 0.5, playheadMs));
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      onWindowChange(zoomWindow(viewWindow, scopeSpanMs, minWindowMs, 2, playheadMs));
    } else if (event.key === '0') {
      event.preventDefault();
      onWindowChange({ startMs: 0, endMs: scopeSpanMs });
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      onWindowChange(panWindow(viewWindow, scopeSpanMs, minWindowMs, -spanMs));
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      onWindowChange(panWindow(viewWindow, scopeSpanMs, minWindowMs, spanMs));
    }
  };

  const stripMsFromClientX = (clientX: number): number => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * scopeSpanMs;
  };

  const onStripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ms = stripMsFromClientX(event.clientX);
    if (!fullView && ms >= viewWindow.startMs && ms <= viewWindow.endMs) {
      dragRef.current = { mode: 'pan', anchorMs: ms, startMs: viewWindow.startMs };
      return;
    }
    dragRef.current = { mode: 'brush', anchorMs: ms, currentMs: ms };
    setBrushPreview({ startMs: ms, endMs: ms });
  };

  const onStripPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const ms = stripMsFromClientX(event.clientX);
    if (drag.mode === 'pan') {
      const width = windowSpanMs(viewWindow);
      const startMs = drag.startMs + (ms - drag.anchorMs);
      onWindowChange(clampWindow({ startMs, endMs: startMs + width }, scopeSpanMs, minWindowMs));
      return;
    }
    drag.currentMs = ms;
    setBrushPreview({
      startMs: Math.min(drag.anchorMs, ms),
      endMs: Math.max(drag.anchorMs, ms),
    });
  };

  const onStripPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setBrushPreview(null);
    if (!drag || drag.mode === 'pan') return;

    const startMs = Math.min(drag.anchorMs, drag.currentMs);
    const endMs = Math.max(drag.anchorMs, drag.currentMs);
    if (endMs - startMs < minWindowMs) {
      // A tap, not a brush — move the playhead there and let the caller page.
      onPlayheadChange(drag.currentMs);
      return;
    }
    onWindowChange(clampWindow({ startMs, endMs }, scopeSpanMs, minWindowMs));
  };

  useEffect(() => {
    setHoverInspect(null);
  }, [viewWindow.startMs, viewWindow.endMs, renderMode]);

  const playheadFrac = windowFrac(viewWindow, playheadMs);
  const playheadVisible = playheadFrac >= -0.001 && playheadFrac <= 1.001;
  const ticks = useMemo(() => axisTicks(viewWindow, 5), [viewWindow]);
  const activeBrush = brushPreview ?? viewWindow;

  const frameStyle = {
    '--replay-playhead-x': `${clamp(playheadFrac, 0, 1) * 100}%`,
    '--replay-lane-min': `${LANE_MIN_HEIGHT}px`,
  } as CSSProperties;

  const windowLabel = fullView
    ? `Full range, ${formatSpan(scopeSpanMs)}`
    : `Focus window ${formatAxis(viewWindow.startMs)} to ${formatAxis(viewWindow.endMs)}, ${formatSpan(spanMs)} of ${formatSpan(scopeSpanMs)}`;

  const yFor = (value: number) =>
    PLOT_PAD_TOP + (1 - heightFor(value)) * (LINES_SVG_HEIGHT - PLOT_PAD_TOP - PLOT_PAD_BOTTOM);

  return (
    <div className={styles.stageFrame} style={frameStyle}>
      <div className={styles.chartBody}>
        <div className={styles.yAxis} aria-hidden="true">
          <span className={styles.yAxisLabel}>Relative activity</span>
          {renderMode === 'lines'
            ? GRID_TICKS.map((tick) => (
                <span
                  key={tick}
                  className={styles.yTick}
                  style={{
                    top: `${((PLOT_PAD_TOP + (1 - tick / 100) * (LINES_SVG_HEIGHT - PLOT_PAD_TOP - PLOT_PAD_BOTTOM)) / LINES_SVG_HEIGHT) * 100}%`,
                  }}
                >
                  {tick}
                </span>
              ))
            : null}
        </div>

        <div
          ref={plotRef}
          className={styles.plotArea}
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={Math.round(scopeSpanMs)}
          aria-valuenow={Math.round(playheadMs)}
          aria-valuetext={`${formatAxis(playheadMs)}. ${windowLabel}. Plus and minus zoom, zero resets.`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        >
          {series.length === 0 || chartData.length === 0 ? (
            <p className={styles.plotEmpty}>No activity captured in this scope.</p>
          ) : renderMode === 'lines' ? (
            <svg
              className={styles.svg}
              viewBox={`0 0 ${SVG_WIDTH} ${LINES_SVG_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {GRID_TICKS.map((tick) => (
                <line
                  key={tick}
                  className={styles.gridLine}
                  x1={0}
                  x2={SVG_WIDTH}
                  y1={yFor((tick / 100) * windowMax)}
                  y2={yFor((tick / 100) * windowMax)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {series.map((item) => {
                const path = segmentsToLine(segmentsBySeries.get(item.key) ?? [], viewWindow, yFor);
                return path ? (
                  <path
                    key={item.key}
                    className={styles.seriesLine}
                    d={path}
                    stroke={item.color}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null;
              })}
            </svg>
          ) : (
            <div className={styles.laneColumn}>
              {series.map((item) => {
                const segments = segmentsBySeries.get(item.key) ?? [];
                const laneY = (value: number) =>
                  LANE_SVG_HEIGHT - 2 - heightFor(value) * (LANE_SVG_HEIGHT - 6);
                const area = segmentsToArea(segments, viewWindow, laneY, LANE_SVG_HEIGHT - 2);
                const line = segmentsToLine(segments, viewWindow, laneY);
                const peak = seriesPeaks.get(item.key) ?? 0;
                return (
                  // The lane SVG spans the full plot width so every lane, the
                  // marker rail, the axis, and the playhead share one x-mapping.
                  // Label and peak float above it rather than taking columns.
                  <div
                    key={item.key}
                    className={styles.lane}
                    // The peak reads as a bare number in a 2xs mono corner, so the
                    // absence has room for a word and not for the sentence that
                    // explains it. `.lanePeak` is pointer-events:none, so the row
                    // carries the title.
                    title={peak > 0 ? undefined : 'No measured peak for this lane in this window'}
                  >
                    <svg
                      className={styles.laneSvg}
                      viewBox={`0 0 ${SVG_WIDTH} ${LANE_SVG_HEIGHT}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <line
                        className={styles.laneBaseline}
                        x1={0}
                        x2={SVG_WIDTH}
                        y1={LANE_SVG_HEIGHT - 2}
                        y2={LANE_SVG_HEIGHT - 2}
                        vectorEffect="non-scaling-stroke"
                      />
                      {area ? <path className={styles.laneArea} d={area} fill={item.color} /> : null}
                      {line ? (
                        <path
                          className={styles.laneLine}
                          d={line}
                          stroke={item.color}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </svg>
                    <span className={styles.laneLabel}>
                      <span
                        className={styles.laneSwatch}
                        style={{ background: item.color }}
                        aria-hidden="true"
                      />
                      <span className={styles.laneName}>{item.label}</span>
                    </span>
                    <span className={styles.lanePeak}>
                      {peak > 0 ? Math.round((peak / Math.max(windowMax, 0.0001)) * 100) : 'none'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {hoverInspect ? (
            <span
              className={styles.hoverLine}
              style={{ left: `${clamp(hoverInspect.frac, 0, 1) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}

          {hoverInspect && renderMode === 'lines'
            ? hoverInspect.points.slice(0, HOVER_DOT_MAX).map((point) => (
                <span
                  key={point.key}
                  className={styles.hoverDot}
                  style={{
                    left: `${clamp(hoverInspect.frac, 0, 1) * 100}%`,
                    top: `${(yFor(point.value) / LINES_SVG_HEIGHT) * 100}%`,
                    background: point.color,
                  }}
                  aria-hidden="true"
                />
              ))
            : null}

          {playheadVisible ? (
            <span
              className={styles.playheadLine}
              style={{ left: `${clamp(playheadFrac, 0, 1) * 100}%` }}
              aria-hidden="true"
            />
          ) : null}

          {hoverInspect ? (
            <div
              className={styles.hoverCard}
              style={{
                left: `${clamp(hoverInspect.frac, 0, 1) * 100}%`,
                transform:
                  hoverInspect.frac > 0.72
                    ? 'translateX(-100%)'
                    : hoverInspect.frac < 0.28
                      ? 'translateX(0)'
                      : 'translateX(-50%)',
              }}
            >
              <span className={styles.hoverTime}>
                {formatAxis(hoverInspect.elapsedMs)}
              </span>
              {hoverInspect.points.length > 0 ? (
                <>
                  {hoverInspect.points.slice(0, HOVER_CARD_MAX).map((point) => (
                    <span key={point.key} className={styles.hoverRow}>
                      <span
                        className={styles.hoverSwatch}
                        style={{ background: point.color }}
                        aria-hidden="true"
                      />
                      <span className={styles.hoverLabel}>{point.label}</span>
                      <span className={styles.hoverValue}>
                        {Math.round(point.height * 100)}
                      </span>
                    </span>
                  ))}
                  {hoverInspect.points.length > HOVER_CARD_MAX ? (
                    <span className={styles.hoverOverflow}>
                      +{hoverInspect.points.length - HOVER_CARD_MAX} more
                    </span>
                  ) : null}
                </>
              ) : (
                <span className={styles.hoverEmpty}>No activity here</span>
              )}
              {hoverInspect.bin ? (
                <span className={styles.hoverMoments}>
                  {hoverInspect.bin.count.toLocaleString()}{' '}
                  {hoverInspect.bin.count === 1 ? 'moment' : 'moments'}
                  {hoverInspect.bin.attentionCount > 0
                    ? `, ${hoverInspect.bin.attentionCount.toLocaleString()} ${
                        hoverInspect.bin.attentionCount === 1 ? 'needs' : 'need'
                      } attention`
                    : ''}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.markerRail} aria-hidden="true">
          {markerBins.map((bin) => (
            <span
              key={bin.id}
              className={`${styles.bin} ${markerToneClass(bin.tone)}`}
              style={{
                left: `${bin.frac * 100}%`,
                height: `${Math.max(22, (bin.count / Math.max(1, binPeak)) * 100)}%`,
              }}
            />
          ))}
        </div>

        <div className={styles.xAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.elapsedMs} className={styles.xTick} style={{ left: `${tick.frac * 100}%` }}>
              {formatAxis(tick.elapsedMs)}
            </span>
          ))}
        </div>

        <div className={styles.stripRow}>
          <div
            ref={stripRef}
            className={styles.strip}
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerUp={onStripPointerUp}
            onPointerCancel={onStripPointerUp}
          >
            <svg
              className={styles.stripSvg}
              viewBox={`0 0 ${SVG_WIDTH} ${STRIP_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {(() => {
                const scopeWindow = { startMs: 0, endMs: scopeSpanMs };
                const segments = seriesSegments(stripAggregate.totals, 'total', gapMs);
                const stripY = (value: number) =>
                  STRIP_HEIGHT -
                  2 -
                  (stripAggregate.max <= 0 ? 0 : clamp(value / stripAggregate.max, 0, 1)) *
                    (STRIP_HEIGHT - 8);
                const area = segmentsToArea(segments, scopeWindow, stripY, STRIP_HEIGHT - 2);
                return area ? <path className={styles.stripArea} d={area} /> : null;
              })()}
              {stripMarkerBins
                .filter((bin) => bin.attentionCount > 0)
                .map((bin) => (
                  <line
                    key={bin.id}
                    className={styles.stripAttention}
                    x1={bin.frac * SVG_WIDTH}
                    x2={bin.frac * SVG_WIDTH}
                    y1={STRIP_HEIGHT - 2}
                    y2={
                      STRIP_HEIGHT -
                      2 -
                      Math.max(4, (bin.attentionCount / Math.max(1, stripBinPeak)) * (STRIP_HEIGHT - 8))
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </svg>

            <span
              className={clsx(
                styles.stripBand,
                brushPreview && styles.stripBandBrushing,
                fullView && !brushPreview && styles.stripBandFull,
              )}
              style={{
                left: `${clamp(activeBrush.startMs / scopeSpanMs, 0, 1) * 100}%`,
                width: `${clamp((activeBrush.endMs - activeBrush.startMs) / scopeSpanMs, 0, 1) * 100}%`,
              }}
              aria-hidden="true"
            />
            <span
              className={styles.stripPlayhead}
              style={{ left: `${clamp(playheadMs / scopeSpanMs, 0, 1) * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <span className={styles.srOnly} role="status">
            {windowLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
