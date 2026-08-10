import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './DetailTable.module.css';

export interface DetailColumn<Row> {
  key: string;
  /** Column heading. Omit on EVERY column to render a headerless table
   *  (e.g. a label|timestamp event list). */
  header?: ReactNode;
  /** Text alignment for the cell + header. Default 'start'. */
  align?: 'start' | 'end';
  /** CSS grid track for this column, e.g. '1.2fr' | 'auto' | '96px'.
   *  Default '1fr'. */
  width?: string;
  /** Let this column's text wrap instead of truncating with an ellipsis. For a
   *  prose column (a message, a "why" sentence) where the content IS the point
   *  and clipping it would lose meaning. When any column wraps, rows top-align so
   *  the short cells sit at the first line of the tall one. */
  wrap?: boolean;
  /** Cell renderer. Return a plain node; wrap in a <span style> for a
   *  per-row tone (status color) — the table does not own semantics. */
  render: (row: Row) => ReactNode;
}

interface Props<Row> {
  columns: ReadonlyArray<DetailColumn<Row>>;
  rows: ReadonlyArray<Row>;
  /** Stable key per row. */
  rowKey: (row: Row) => string;
  ariaLabel?: string;
}

/**
 * The one tabular primitive for detail drills: an optional mono header row
 * and a set of grid rows that stagger in. Replaces the hand-rolled
 * `outcomesTable` / `firedTimeline` / live-session grids that each
 * re-invented the same header + `--row-index` row shape.
 *
 * It is non-interactive by design. Clickable leaderboards (project rows,
 * live sessions you can open) stay on the `dataList`/`dataRow` button
 * vocabulary — this is for reading, not navigating.
 */
export default function DetailTable<Row>({ columns, rows, rowKey, ariaLabel }: Props<Row>) {
  const template = columns.map((c) => c.width ?? '1fr').join(' ');
  const hasHeader = columns.some((c) => c.header != null);
  const hasWrap = columns.some((c) => c.wrap);
  const gridStyle = { gridTemplateColumns: template } as CSSProperties;

  return (
    <div className={styles.table} role="table" aria-label={ariaLabel}>
      {hasHeader && (
        <div className={styles.header} role="row" style={gridStyle}>
          {columns.map((c) => (
            <span
              key={c.key}
              role="columnheader"
              className={clsx(styles.headerCell, c.align === 'end' && styles.end)}
            >
              {c.header}
            </span>
          ))}
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={rowKey(row)}
          className={clsx(styles.row, hasWrap && styles.rowWrap)}
          role="row"
          style={{ ...gridStyle, '--row-index': i } as CSSProperties}
        >
          {columns.map((c) => (
            <span
              key={c.key}
              role="cell"
              className={clsx(styles.cell, c.align === 'end' && styles.end, c.wrap && styles.wrap)}
            >
              {c.render(row)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
