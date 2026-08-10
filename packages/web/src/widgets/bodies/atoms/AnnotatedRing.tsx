import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  arcPath,
  computeArcSlices,
  computeLeaderGeometry,
  pickLabeledArcs,
  CX,
  CY,
  R,
  SW,
  GAP,
  type LeaderPoints,
} from '../../../lib/svgArcs.js';
import styles from './AnnotatedRing.module.css';

// Invisible fat path under each arc enlarges the hover hit area so users
// don't need to land precisely on the 13-unit-wide stroke.
const HOVER_HIT_WIDTH = SW + 16;

export interface AnnotatedRingArc {
  /** Stable identity for React keys + ARIA. */
  key: string;
  /** Raw magnitude. Drives arc sweep proportionally. */
  value: number;
  /** Stroke color for the arc and leader-label %. CSS var or hex. */
  color: string;
  /** Display label for leader-line annotation. Defaults to `key`. */
  label?: string;
  /**
   * When true, the arc renders muted and is excluded from leader-line
   * annotations + hover linking. Use for aggregate "other" tail buckets that
   * have no single-category meaning.
   */
  muted?: boolean;
}

export type AnnotatedRingLabelSide = 'left' | 'right' | 'both';

export interface AnnotatedRingProps {
  arcs: AnnotatedRingArc[];
  /** Hero number/text rendered in the ring center. */
  centerValue?: ReactNode;
  /** Eyebrow caption rendered just below the center value. */
  centerEyebrow?: ReactNode;
  /**
   * Which side of the ring is allowed to render leader-line labels.
   * Use 'right' when the ring sits at the LEFT of a row with a table to its
   * right — labels render into the gap. 'left' for the mirror layout. 'both'
   * when the ring is the only thing in the cell.
   */
  labelSide?: AnnotatedRingLabelSide;
  /** Accessible label for the SVG. */
  ariaLabel?: string;
  /** Gap (degrees) between adjacent arc segments. Defaults to GAP from svgArcs. */
  gapDeg?: number;
  /** Optional className applied to the SVG element. The caller sizes the SVG
   * (typically `width: 260px; height: auto; overflow: visible`). */
  className?: string;
  /**
   * Optional minimum vertical pixel gap between labels on the same side
   * (in viewBox units). Defaults to the svgArcs MIN_LABEL_GAP. Lower
   * values let more labels fit at the cost of risk-of-overlap.
   */
  minLabelGap?: number;
  /**
   * Currently hovered arc key (Tools-tab pattern). Non-null dims every other
   * non-muted arc to 0.15 and keeps the hovered one at full opacity, so a
   * hover on a sibling table row visually highlights its slice.
   */
  hoveredKey?: string | null;
  /**
   * Leader-line % callouts on the ring. Off when a legend table carries the
   * same facts (cockpit widget face).
   */
  showLeaderLabels?: boolean;
  /**
   * Called with the arc key on mouseenter / null on mouseleave. Lets the
   * caller mirror the hover into table rows so the linking is bidirectional.
   * Muted arcs do NOT fire (they're aggregate buckets with no row).
   */
  onHover?: (key: string | null) => void;
}

interface ResolvedArc {
  key: string;
  value: number;
  share: number;
  color: string;
  label: string;
  muted: boolean;
  startDeg: number;
  sweepDeg: number;
  leader: LeaderPoints;
  labeled: boolean;
}

/**
 * Donut/ring chart with optional leader-line annotations and center text.
 *
 * viewBox is 0 0 260 260; the caller sizes the SVG via className and is
 * expected to set `overflow: visible` so leader-line labels rendered outside
 * the viewBox area stay painted. Arc colors come from the caller so each
 * widget can apply its own palette.
 */
export function AnnotatedRing({
  arcs,
  centerValue,
  centerEyebrow,
  labelSide = 'both',
  ariaLabel,
  gapDeg = GAP,
  className,
  minLabelGap,
  hoveredKey = null,
  showLeaderLabels = true,
  onHover,
}: AnnotatedRingProps) {
  const resolved = useMemo<ResolvedArc[]>(() => {
    if (arcs.length === 0) return [];
    const total = arcs.reduce((s, a) => s + a.value, 0);
    if (total <= 0) return [];

    const segments = computeArcSlices(
      arcs.map((a) => a.value),
      gapDeg,
    );
    const leaders = computeLeaderGeometry(segments);

    const draft: ResolvedArc[] = arcs.map((a, i) => ({
      key: a.key,
      value: a.value,
      share: a.value / total,
      color: a.color,
      label: a.label ?? a.key,
      muted: !!a.muted,
      startDeg: segments[i].startDeg,
      sweepDeg: segments[i].sweepDeg,
      leader: leaders[i],
      labeled: false,
    }));

    const labeled = showLeaderLabels
      ? pickLabeledArcs(
          draft.map((a) => ({
            value: a.value,
            labelY: a.leader.labelY,
            side: a.leader.side,
            muted: a.muted,
          })),
          {
            minGap: minLabelGap,
            exclude: (e) => e.muted || (labelSide !== 'both' && e.side !== labelSide),
          },
        )
      : [];
    for (const i of labeled) draft[i].labeled = true;
    return draft;
  }, [arcs, gapDeg, labelSide, minLabelGap, showLeaderLabels]);

  if (resolved.length === 0) return null;

  return (
    <svg
      viewBox="0 0 260 260"
      overflow="visible"
      className={className}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      {resolved.map((arc) => {
        if (arc.sweepDeg <= 0.2) return null;
        const dimmed = !arc.muted && hoveredKey != null && hoveredKey !== arc.key;
        const highlighted = !arc.muted && hoveredKey === arc.key;
        const baseOpacity = arc.muted ? 0.55 : highlighted ? 1 : 0.85;
        const handleEnter = arc.muted || !onHover ? undefined : () => onHover(arc.key);
        const handleLeave = arc.muted || !onHover ? undefined : () => onHover(null);
        return (
          <g
            key={arc.key}
            style={{ opacity: dimmed ? 0.15 : 1, transition: 'opacity 0.2s ease' }}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {!arc.muted && onHover && (
              <path
                d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
                fill="none"
                stroke="transparent"
                strokeWidth={HOVER_HIT_WIDTH}
                style={{ cursor: 'pointer' }}
              />
            )}
            <path
              d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
              fill="none"
              stroke={arc.color}
              strokeWidth={SW}
              strokeLinecap="round"
              opacity={baseOpacity}
              style={{ transition: 'opacity 0.2s ease' }}
            />
          </g>
        );
      })}
      {resolved.map((arc) => {
        if (!arc.labeled) return null;
        const dimmed = !arc.muted && hoveredKey != null && hoveredKey !== arc.key;
        return (
          <g
            key={`${arc.key}-label`}
            pointerEvents="none"
            style={{ opacity: dimmed ? 0.15 : 1, transition: 'opacity 0.2s ease' } as CSSProperties}
          >
            <path
              d={`M ${arc.leader.anchorX} ${arc.leader.anchorY} L ${arc.leader.elbowX} ${arc.leader.elbowY} L ${arc.leader.labelX} ${arc.leader.labelY}`}
              fill="none"
              stroke="var(--faint)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <text
              x={arc.leader.labelX}
              y={arc.leader.labelY - 4}
              textAnchor={arc.leader.side === 'right' ? 'start' : 'end'}
              fill={arc.color}
              className={styles.labelShare}
            >
              {Math.round(arc.share * 100)}%
            </text>
            <text
              x={arc.leader.labelX}
              y={arc.leader.labelY + 10}
              textAnchor={arc.leader.side === 'right' ? 'start' : 'end'}
              fill="var(--muted)"
              className={styles.labelName}
            >
              {arc.label}
            </text>
          </g>
        );
      })}
      {centerValue != null && (
        <text
          x={CX}
          y={CY - 12}
          textAnchor="middle"
          dominantBaseline="central"
          className={styles.centerValue}
        >
          {centerValue}
        </text>
      )}
      {centerEyebrow != null && (
        <text
          x={CX}
          y={CY + 18}
          textAnchor="middle"
          dominantBaseline="hanging"
          className={styles.centerEyebrow}
        >
          {centerEyebrow}
        </text>
      )}
    </svg>
  );
}
