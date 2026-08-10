import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';
import {
  collectionPanelVisible,
  getCollectionAttention,
  getCollectionSummary,
  type CollectionRow,
} from '../../lib/widgetReadiness.js';
import { navigate } from '../../lib/router.js';
import Banner from '../Banner/Banner.js';
import styles from './CollectionPanel.module.css';
import glass from '../surface/glass.module.css';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

interface Props {
  overview: OverviewSnapshot;
  capture: CaptureSettings | null;
}

interface ReadinessDialogProps {
  rows: CollectionRow[];
  captureOff: boolean;
  onClose: () => void;
}

function AttentionRow({ row }: { row: CollectionRow }) {
  const progress = `${row.readyCount}/${row.totalCount} ready`;

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemLabel}>{row.label}</span>
        <span className={styles.itemProgress}>{progress}</span>
      </div>
      <ul className={styles.pendingList}>
        {row.pendingStats.map((stat) => (
          <li key={stat.id} className={styles.pendingItem}>
            <span className={styles.statName}>/ {titleCase(stat.label)}</span>
            <span className={styles.statMessage}>{stat.message}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function titleCase(label: string): string {
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function statSentenceName(label: string): string {
  return `The ${titleCase(label)} stat`;
}

function ReadinessDialog({ rows, captureOff, onClose }: ReadinessDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();
    return () => previous?.focus();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={styles.dialogLayer} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={clsx(styles.dialog, glass.sheetStrong)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stat-readiness-title"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <div>
            <p className={styles.dialogEyebrow}>Stats</p>
            <h2 id="stat-readiness-title" className={styles.dialogTitle}>
              Why this notice is showing
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
            </svg>
          </button>
        </header>

        <p className={styles.dialogCopy}>
          Seorak only shows a stat once it has enough real activity to calculate it.
          The tree below shows the blocked stat and the reason it is still empty.
        </p>

        <div className={styles.treeHeader} aria-hidden="true">
          <span>Stat</span>
          <span>Status</span>
        </div>
        <ul className={styles.list}>
          {rows.map((row) => (
            <AttentionRow key={row.group} row={row} />
          ))}
        </ul>

        <footer className={styles.dialogActions}>
          <span className={styles.footerNote}>Stats update automatically as real activity lands.</span>
          {captureOff && (
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => {
                onClose();
                navigate('settings');
              }}
            >
              Open settings
            </button>
          )}
          <button type="button" className={styles.secondaryAction} onClick={onClose}>
            Understood
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default function CollectionPanel({ overview, capture }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = useMemo(() => getCollectionSummary(overview, capture), [overview, capture]);
  const attention = useMemo(() => getCollectionAttention(rows), [rows]);

  if (!collectionPanelVisible(rows)) return null;

  const pendingTotal = rows.reduce((s, r) => s + r.attentionCount, 0);
  const captureOff = attention.some((r) => r.state === 'capture-off');
  const pendingStats = attention.flatMap((row) => row.pendingStats);
  const onlyPendingStat = pendingStats.length === 1 ? pendingStats[0] : null;
  const headline = captureOff
    ? 'Some stats need capture settings.'
    : onlyPendingStat
      ? `${statSentenceName(onlyPendingStat.label)} is waiting for enough real activity.`
      : `${pendingTotal} stats are waiting for enough real activity.`;
  const actions = [
    {
      label: 'Why?',
      onClick: () => setDialogOpen(true),
    },
    ...(captureOff
      ? [
          {
            label: 'Settings',
            onClick: () => navigate('settings'),
          },
        ]
      : []),
  ];

  return (
    <section className={styles.panel} aria-label="Stat readiness">
      <Banner variant="info" eyebrow="Stats" actions={actions}>
        {headline}
      </Banner>

      {dialogOpen && (
        <ReadinessDialog
          rows={attention}
          captureOff={captureOff}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </section>
  );
}
