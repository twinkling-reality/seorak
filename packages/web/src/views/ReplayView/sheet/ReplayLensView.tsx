// One renderer per lens FORM, driven entirely by the lens result.
//
// There is deliberately no per-lens JSX: a lens contributes rows and a viz
// name, and this file draws them. That is what keeps the catalog honest as an
// API surface — anything the screen shows, a serialized result already carried.

import clsx from 'clsx';

import type {
  ReplayLensResult,
  ReplayLensRow,
  ReplayLensSection,
  ReplayLensTone,
  ReplayLensViz,
} from '../lenses/types.js';
import styles from './ReplayLensView.module.css';

function toneAttr(tone: ReplayLensTone | undefined): string {
  return tone ?? 'neutral';
}

function RowFacts({ row }: { row: ReplayLensRow }) {
  if (!row.facts || row.facts.length === 0) return null;
  return (
    <span className={styles.facts}>
      {row.facts.map((fact) => (
        <span key={`${fact.label}-${fact.value}`} className={styles.fact} data-tone={toneAttr(fact.tone)}>
          <span className={styles.factLabel}>{fact.label}</span>
          <span className={styles.factValue}>{fact.value}</span>
        </span>
      ))}
    </span>
  );
}

function RankedBars({
  rows,
  onSelectRow,
}: {
  rows: ReplayLensRow[];
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  const interactive = (row: ReplayLensRow) => row.elapsedMs != null || row.target != null;
  return (
    <ul className={styles.bars}>
      {rows.map((row) => {
        const content = (
          <>
            <span className={styles.barHead}>
              <span className={styles.barLabel}>{row.label}</span>
              <span className={styles.barValue}>{row.display}</span>
            </span>
            <span className={styles.barTrack} aria-hidden="true">
              <span
                className={styles.barFill}
                data-tone={toneAttr(row.tone)}
                style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }}
              />
            </span>
            <RowFacts row={row} />
          </>
        );
        return (
          <li key={row.id} className={styles.bar}>
            {interactive(row) ? (
              <button type="button" className={styles.barButton} onClick={() => onSelectRow(row)}>
                {content}
              </button>
            ) : (
              <div className={styles.barStatic}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TimelineMarks({
  rows,
  onSelectRow,
}: {
  rows: ReplayLensRow[];
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  return (
    <div className={styles.marksBlock}>
      <div className={styles.markRail} aria-hidden="true">
        {rows.map((row) => (
          <span
            key={row.id}
            className={styles.mark}
            data-tone={toneAttr(row.tone)}
            style={{ left: `${Math.round((row.share ?? 0) * 100)}%` }}
          />
        ))}
      </div>
      <ul className={styles.markList}>
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className={styles.markRow} onClick={() => onSelectRow(row)}>
              <span className={styles.markTime}>{row.display}</span>
              <span className={styles.markDot} data-tone={toneAttr(row.tone)} aria-hidden="true" />
              <span className={styles.markLabel}>{row.label}</span>
              <RowFacts row={row} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Distribution({ rows }: { rows: ReplayLensRow[] }) {
  return (
    <div className={styles.distribution}>
      <div className={styles.distributionTrack} aria-hidden="true">
        {rows.map((row, index) =>
          // A band with no gaps takes no width. Giving it a minimum sliver
          // would draw zero as if it were something.
          (row.share ?? 0) > 0 ? (
            <span
              key={row.id}
              className={styles.distributionBand}
              data-band={index}
              style={{ flexGrow: row.share }}
            />
          ) : null,
        )}
      </div>
      <ul className={styles.distributionKey}>
        {rows.map((row, index) => (
          <li key={row.id} className={styles.distributionItem}>
            <span className={styles.distributionSwatch} data-band={index} aria-hidden="true" />
            <span className={styles.distributionLabel}>{row.label}</span>
            <span className={styles.distributionValue} data-empty={row.value === 0}>
              {row.display}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LensTable({
  columns,
  rows,
  onSelectRow,
}: {
  columns: string[];
  rows: ReplayLensRow[];
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  const gridTemplate = `minmax(0, 2.2fr) repeat(${columns.length}, minmax(56px, 0.9fr))`;
  return (
    <div className={styles.table} role="table">
      <div className={styles.tableHead} role="row" style={{ gridTemplateColumns: gridTemplate }}>
        <span role="columnheader">Name</span>
        {columns.map((column) => (
          <span key={column} role="columnheader" className={styles.tableNumeric}>
            {column}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className={styles.tableRow}
          role="row"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <button type="button" className={styles.tableName} role="cell" onClick={() => onSelectRow(row)}>
            <span className={styles.tableLabel}>{row.label}</span>
            {row.share != null ? (
              <span
                className={styles.tableShare}
                style={{ width: `${Math.round(row.share * 100)}%` }}
                aria-hidden="true"
              />
            ) : null}
          </button>
          {(row.cells ?? []).map((cell, index) => (
            <span
              key={`${row.id}-${index}`}
              role="cell"
              className={clsx(styles.tableCell, styles.tableNumeric)}
              data-tone={toneAttr(row.cellTones?.[index])}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function StatGrid({ rows }: { rows: ReplayLensRow[] }) {
  return (
    <dl className={styles.statGrid}>
      {rows.map((row) => (
        <div key={row.id} className={styles.stat}>
          <dt>{row.label}</dt>
          <dd data-tone={toneAttr(row.tone)}>{row.display}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompareRows({ columns, rows }: { columns: string[]; rows: ReplayLensRow[] }) {
  const gridTemplate = `minmax(0, 1.6fr) repeat(${columns.length - 1}, minmax(66px, 1fr))`;
  return (
    <div className={styles.table} role="table">
      <div className={styles.tableHead} role="row" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((column, index) => (
          <span
            key={column}
            role="columnheader"
            className={index === 0 ? undefined : styles.tableNumeric}
          >
            {column}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className={styles.tableRow}
          role="row"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span role="cell" className={styles.tableLabel}>
            {row.label}
          </span>
          {(row.cells ?? []).map((cell, index) => (
            <span
              key={`${row.id}-${index}`}
              role="cell"
              className={clsx(styles.tableCell, styles.tableNumeric)}
              data-tone={toneAttr(row.cellTones?.[index])}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Body({
  viz,
  rows,
  columns,
  onSelectRow,
}: {
  viz: ReplayLensViz;
  rows: ReplayLensRow[];
  columns: string[] | undefined;
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  if (rows.length === 0) return null;
  switch (viz) {
    case 'ranked-bars':
      return <RankedBars rows={rows} onSelectRow={onSelectRow} />;
    case 'timeline-marks':
      return <TimelineMarks rows={rows} onSelectRow={onSelectRow} />;
    case 'distribution':
      return <Distribution rows={rows} />;
    case 'table':
      return <LensTable columns={columns ?? []} rows={rows} onSelectRow={onSelectRow} />;
    case 'stat-grid':
      return <StatGrid rows={rows} />;
    case 'compare-rows':
      return <CompareRows columns={columns ?? []} rows={rows} />;
  }
}

function Section({
  section,
  onSelectRow,
}: {
  section: ReplayLensSection;
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionLabel}>{section.label}</h4>
      <Body
        viz={section.viz}
        rows={section.rows}
        columns={section.columns}
        onSelectRow={onSelectRow}
      />
    </div>
  );
}

/** Coverage line — states what the numbers cover rather than implying it. */
function Coverage({ result }: { result: ReplayLensResult }) {
  const { coverage } = result;
  const parts: string[] = [];
  if (coverage.windowed) parts.push('Scoped to the focus window');
  if (coverage.loadedCount < coverage.sessionCount) {
    parts.push(
      `${coverage.loadedCount.toLocaleString()} of ${coverage.sessionCount.toLocaleString()} replays loaded`,
    );
  }
  if (parts.length === 0) return null;
  return <p className={styles.coverage}>{parts.join(' and ')}.</p>;
}

export default function ReplayLensView({
  result,
  onSelectRow,
}: {
  result: ReplayLensResult;
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  return (
    <div className={styles.lens}>
      {result.empty ? (
        <p className={styles.empty}>{result.empty}</p>
      ) : (
        <>
          {result.headline ? <p className={styles.headline}>{result.headline}</p> : null}
          <Body
            viz={result.viz}
            rows={result.rows}
            columns={result.columns}
            onSelectRow={onSelectRow}
          />
          {result.secondary ? (
            <Section section={result.secondary} onSelectRow={onSelectRow} />
          ) : null}
        </>
      )}
      <Coverage result={result} />
    </div>
  );
}
