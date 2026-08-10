// The lens sheet: a near-solid surface that slides up over a dimmed stage.
//
// Deliberately NOT glass. The design language keeps large content surfaces
// near-white so evidence stays legible and reserves glass for small floating
// controls — a frosted panel under a dense table would make the reader fight
// the chart for contrast. Dimming the stage keeps context without that cost.

import { useEffect, useRef } from 'react';
import clsx from 'clsx';

import { lensGroupsForLevel } from '../lenses/index.js';
import type {
  ReplayLensDef,
  ReplayLensResult,
  ReplayLensRow,
  ReplayLevel,
} from '../lenses/types.js';
import ReplayLensView from './ReplayLensView.js';
import styles from './ReplayLensSheet.module.css';

export default function ReplayLensSheet({
  lens,
  level,
  result,
  onClose,
  onSelectLens,
  onSelectRow,
}: {
  lens: ReplayLensDef;
  level: ReplayLevel;
  result: ReplayLensResult;
  onClose: () => void;
  onSelectLens: (id: string) => void;
  onSelectRow: (row: ReplayLensRow) => void;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const groups = lensGroupsForLevel(level);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
  }, [lens.id]);

  return (
    <>
      <button
        type="button"
        className={styles.scrim}
        aria-label="Close lens"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className={clsx(styles.sheet)}
        role="region"
        aria-label={`${lens.name} lens`}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.title}>
            <h3 className={styles.name}>{lens.name}</h3>
            <p className={styles.description}>{lens.description}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.split}>
          {/* The catalog, where a lens is actually read. Comparing two lenses
              used to mean close → scan the tray → reopen; here it is one
              click, and the grouping states which question each one answers. */}
          <nav className={styles.rail} aria-label="Switch lens">
            {groups.map((group) => (
              <div key={group.question} className={styles.railGroup}>
                <span className={styles.railGroupLabel}>{group.label}</span>
                {group.lenses.map((entry) => {
                  const active = entry.id === lens.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={clsx(styles.railItem, active && styles.railItemActive)}
                      aria-current={active ? 'true' : undefined}
                      title={entry.description}
                      onClick={() => onSelectLens(entry.id)}
                    >
                      {entry.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className={styles.body}>
            <ReplayLensView result={result} onSelectRow={onSelectRow} />
          </div>
        </div>
      </section>
    </>
  );
}
