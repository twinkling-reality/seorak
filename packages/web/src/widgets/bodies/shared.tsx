import clsx from 'clsx';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';
import Tooltip from '../../components/Tooltip/Tooltip.js';
import { readinessEmptyMessage } from '../../lib/widgetReadiness.js';
import { formatCost } from '../utils.js';
import styles from '../widget-shared.module.css';

/** How to format the inline delta magnitude shown next to a stat value. */
export type StatDeltaFormat = 'count' | 'usd';

/**
 * Row cap for compact cockpit tables that reserve a final line for the
 * SectionOverflow affordance.
 */
export function visibleRowsWithOverflow(
  total: number,
  noOverflowCap: number,
  withOverflowCap: number,
): number {
  return total > noOverflowCap ? withOverflowCap : total;
}

export function StatWidget({
  value,
  delta,
  deltaFormat = 'count',
  deltaComparison,
  titleHint,
  active,
  onSelect,
  selectAriaLabel,
  onOpenDetail,
  detailAriaLabel,
}: {
  value: string;
  delta?: { current: number | null; previous: number | null } | null;
  deltaFormat?: StatDeltaFormat;
  /** Threshold-true comparator sentence for the delta's hover ("$282.65 this
   *  30-day window vs $231.77 the 30 days before."). Every delta names what
   *  it compares against — the glyph alone never carries the meaning. */
  deltaComparison?: string;
  /** Native hover for relocated face captions (derivation, sample size).
   *  DASHBOARD-CLARITY P1: the face keeps one value; the how lives here. */
  titleHint?: string;
  active?: boolean;
  onSelect?: () => void;
  selectAriaLabel?: string;
  onOpenDetail?: () => void;
  detailAriaLabel?: string;
}) {
  const deltaEl =
    delta && delta.current != null && delta.previous != null && delta.previous > 0 ? (
      <InlineDelta
        value={delta.current - delta.previous}
        format={deltaFormat}
        comparison={deltaComparison}
      />
    ) : null;

  if (active !== undefined) {
    const valueClass = active
      ? styles.heroStatValue
      : `${styles.heroStatValue} ${styles.heroStatInactive}`;
    return (
      <div className={styles.statFace}>
        <button
          type="button"
          className={styles.statSelectButton}
          onClick={onSelect}
          aria-label={selectAriaLabel}
          aria-pressed={active}
          title={titleHint}
        >
          <span className={valueClass}>
            {value}
            {deltaEl}
          </span>
        </button>
      </div>
    );
  }

  // Delta is a SIBLING of the hero value, not nested inside it: heroStatValue
  // is nowrap+ellipsis, so an inline delta gets clipped when the value+delta is
  // wider than the tile (the cost tile at colSpan-3). As a sibling under the
  // wrapping statButton, the delta drops to its own line instead of truncating.
  // On the button-less path the hero value span carries the titleHint itself.
  const inner = (
    <>
      <span className={styles.heroStatValue} title={onOpenDetail ? undefined : titleHint}>
        {value}
      </span>
      {deltaEl}
    </>
  );
  if (!onOpenDetail) {
    return <div className={styles.statFace}>{inner}</div>;
  }
  return (
    <div className={styles.statFace}>
      <button
        type="button"
        className={styles.statButton}
        onClick={onOpenDetail}
        aria-label={detailAriaLabel}
        title={titleHint}
      >
        <span className={styles.heroStatValue}>{value}</span>
        <span className={styles.statTrailing}>
          {deltaEl}
          <span className={styles.statDetailArrow} aria-hidden="true">
            ↗
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * Inline arrow+magnitude delta. One meaning everywhere: this window vs the
 * adjacent prior window, and the `comparison` sentence states it on hover.
 * Neutral ink by design — direction is the arrow's job, and Seorak does not
 * grade movement (cost up in a productive week is not "bad"; never
 * success/danger paint on a delta).
 */
export function InlineDelta({
  value,
  format = 'count',
  comparison,
}: {
  value: number;
  format?: StatDeltaFormat;
  /** Threshold-true hover naming the comparator. Omit only when the
   *  surrounding element already states it in text. */
  comparison?: string;
}) {
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  const magnitude =
    format === 'usd'
      ? formatCost(Math.abs(value), 2)
      : String(Math.abs(Math.round(value * 10) / 10));
  const pill = (
    <span className={styles.statInlineDelta}>
      {arrow}
      {magnitude}
    </span>
  );
  if (!comparison) return pill;
  return (
    <Tooltip label={comparison} placement="right" wrap>
      {pill}
    </Tooltip>
  );
}

export function GhostStatRow({ labels }: { labels: string[] }) {
  return (
    <div className={styles.ghostStatRow}>
      {labels.map((l) => (
        <div key={l} className={styles.statBlock}>
          <span className={styles.ghostStatValue}>—</span>
          <span className={styles.statBlockLabel}>{l}</span>
        </div>
      ))}
    </div>
  );
}

// (GhostBars / GhostRows deleted 2026-07-02: skeleton rows read as "loading"
// where the true state is "no rows yet" — honest-empty is SectionEmpty. The
// last user was model-mix's empty state, replaced in the strip-face
// standardization pass.)

/** Inline coverage note for capability-gated widgets. Falls through to nothing
 *  when there is no disclosure to make. The data attribute is the stable
 *  cross-module contract (same pattern as [data-wts='card']): WidgetRenderer's
 *  stat-centering rules need :has() to see this note, and the class name is
 *  hashed per-module so a foreign-module class selector can never match. */
export function CoverageNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className={styles.coverageNote} data-coverage-note="">
      {text}
    </div>
  );
}

/** Central empty stat: `--` + readiness message from the shared layer. */
export function ReadinessStatEmpty({
  widgetId,
  overview,
  capture,
  fallback,
}: {
  widgetId: string;
  overview: OverviewSnapshot;
  capture?: CaptureSettings | null;
  fallback?: string;
}) {
  const text = readinessEmptyMessage(widgetId, overview, capture) ?? fallback ?? null;
  return (
    <>
      <StatWidget value="--" />
      {text && <CoverageNote text={text} />}
    </>
  );
}

/** Central SectionEmpty message from readiness, with optional fallback. */
export function readinessSectionText(
  widgetId: string,
  overview: OverviewSnapshot,
  capture: CaptureSettings | null | undefined,
  fallback: string,
): string {
  return readinessEmptyMessage(widgetId, overview, capture) ?? fallback;
}

/**
 * Canonical file-path renderer. Filename is ink and never truncates; the
 * directory prefix is soft and ellipses if the cell is too narrow.
 */
export function FilePath({
  path,
  order = 'parent-first',
  parentSegments = 2,
  className,
}: {
  path: string;
  order?: 'parent-first' | 'name-first';
  parentSegments?: number;
  className?: string;
}) {
  const { parent, name } = formatFilePath(path, parentSegments);
  const parentClass =
    order === 'parent-first'
      ? clsx(styles.filePathParent, styles.filePathParentLead)
      : styles.filePathParent;
  const parentEl = parent ? <span className={parentClass}>{parent}</span> : null;
  const nameEl = <span className={styles.filePathName}>{name}</span>;
  return (
    <span className={clsx(styles.filePath, className)} title={path}>
      {order === 'parent-first' ? (
        <>
          {parentEl}
          {nameEl}
        </>
      ) : (
        <>
          {nameEl}
          {parentEl}
        </>
      )}
    </span>
  );
}

function formatFilePath(path: string, parentSegments: number): { parent: string; name: string } {
  if (!path) return { parent: '', name: '' };
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return { parent: '', name: path };
  const name = segments[segments.length - 1] ?? '';
  const parentParts = segments.slice(0, -1);
  const visible = parentParts.slice(-Math.max(0, parentSegments));
  const parent = visible.length > 0 ? `${visible.join('/')}/` : '';
  return { parent, name };
}
