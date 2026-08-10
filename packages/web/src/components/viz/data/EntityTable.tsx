import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './EntityTable.module.css';

export interface EntityColumn<Row> {
  key: string;
  /** Mono column header — the unit STATEMENT, so a value cell can be a bare
   *  number (DASHBOARD-CLARITY: table headers carry the unit). */
  header: ReactNode;
  /** Text alignment for header + cells. Default 'start'. Values read 'end'. */
  align?: 'start' | 'end';
  /** CSS grid track, e.g. '1.4fr' | 'auto' | 'minmax(96px, 1fr)'. Default '1fr'. */
  width?: string;
  render: (row: Row) => ReactNode;
  /** Prose column: wrap instead of clipping (its row switches to top alignment
   *  so short cells sit at the wrapped cell's first line). */
  wrap?: boolean;
  /** When present the column is sortable: return its numeric sort key. `null`
   *  always sorts LAST (honest-empty rows sink, never a fabricated 0 rank). */
  sortValue?: (row: Row) => number | null;
}

interface Props<Row> {
  columns: ReadonlyArray<EntityColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  /** Row click opens the entity — makes each row a keyboard-focusable
   *  `<button>`. Omit for a read-only table (use `DetailTable` for that). */
  onRowClick?: (row: Row) => void;
  /** Screen-reader label for a clickable row (the row's cells are visual). */
  rowLabel?: (row: Row) => string;
  /** Initial sort — a sortable column key + direction. */
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  ariaLabel?: string;
  /** Optional action rendered above the table (e.g. a compare CTA). */
  action?: ReactNode;
  /** Per-row drill affordance label (e.g. "Replay"). Renders a trailing
   *  viewPill in each row that inverts to accent on ROW hover — the same shared
   *  primitive the widget tables + LiveSessionsTable use. Requires onRowClick:
   *  the row itself is the button, the pill is only the visual affordance. */
  actionLabel?: string;
}

/**
 * EntityTable — the navigable "entities × columns" table.
 *
 * The interactive sibling of `DetailTable`: same mono-header + grid-row shape,
 * but rows are `<button>`s that open the entity and any column can declare a
 * `sortValue` to make its header a sort control. This is the one primitive for
 * clickable leaderboards that compare a handful of entities across a few
 * columns (projects, live sessions, repo activity) — collapsing what used to be
 * one single-value list PER measure into one table the reader sorts in place.
 *
 * Honesty: a cell with no value renders "--" (the caller's job), never a
 * fabricated 0; a null `sortValue` sinks the row rather than ranking it 0. No
 * color-as-status, no decorative dots — the columns and their headers carry the
 * meaning (DASHBOARD-CLARITY drill-face rules).
 */
export default function EntityTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  defaultSort,
  ariaLabel,
  action,
  actionLabel,
}: Props<Row>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(
    defaultSort ?? null,
  );

  // The action pill lives in a trailing track the caller doesn't declare. It is
  // fixed (not auto) so header + rows resolve it identically — see the CSS note.
  const hasAction = Boolean(actionLabel && onRowClick);
  const anyWrap = columns.some((c) => c.wrap);
  const tracks = columns.map((c) => c.width ?? '1fr');
  if (hasAction) tracks.push('72px');
  const template = tracks.join(' ');
  const gridStyle = { gridTemplateColumns: template } as CSSProperties;

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    if (!col?.sortValue) return rows;
    const dir = sort!.dir === 'asc' ? 1 : -1;
    const valueOf = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      // Missing values sink regardless of direction — honest-empty is never a
      // rank, so a repo with no measured rate never sorts above one that has it.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' },
    );

  const RowTag = onRowClick ? 'button' : 'div';

  return (
    <div className={styles.wrap}>
      {action != null && <div className={styles.action}>{action}</div>}
      <div className={styles.table} role="table" aria-label={ariaLabel}>
        <div className={styles.header} role="row" style={gridStyle}>
          {columns.map((c) => {
            const isSorted = sort?.key === c.key;
            const alignEnd = c.align === 'end';
            if (!c.sortValue) {
              return (
                <span
                  key={c.key}
                  role="columnheader"
                  className={clsx(styles.headerCell, alignEnd && styles.end)}
                >
                  {c.header}
                </span>
              );
            }
            return (
              <span
                key={c.key}
                role="columnheader"
                aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={clsx(styles.headerCell, alignEnd && styles.end)}
              >
                <button
                  type="button"
                  className={clsx(styles.sortBtn, isSorted && styles.sortBtnActive)}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.header}
                  <span className={styles.caret} aria-hidden="true">
                    {isSorted ? (sort!.dir === 'asc' ? '↑' : '↓') : ''}
                  </span>
                </button>
              </span>
            );
          })}
          {hasAction && <span role="columnheader" aria-hidden="true" className={styles.headerCell} />}
        </div>

        {sorted.map((row, i) => (
          <RowTag
            key={rowKey(row)}
            {...(onRowClick
              ? { type: 'button' as const, onClick: () => onRowClick(row), 'aria-label': rowLabel?.(row) }
              : { role: 'row' })}
            className={clsx(styles.row, onRowClick && styles.rowClickable, anyWrap && styles.rowWrap)}
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
            {hasAction && <span className={styles.actionPill}>{actionLabel}</span>}
          </RowTag>
        ))}
      </div>
    </div>
  );
}
