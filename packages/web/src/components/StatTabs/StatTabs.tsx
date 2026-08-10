import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import type { TabControl } from '../DetailView/DetailView.js';
import styles from './StatTabs.module.css';

export interface StatTabDef<T extends string> {
  id: T;
  label: string;
  /** Large line beneath the label — a stat in analytical views, a section
   *  title in configuration surfaces (pass `variant: 'section'`). */
  value: ReactNode;
  /** `stat` (default): mono label + numeric KPI. `section`: eyebrow + display
   *  title, matching ViewHeader hierarchy (Settings section tabs). */
  variant?: 'stat' | 'section';
  /** Period-comparison annotation rendered as a small mono caption
   *  below the value (e.g. "↑26"). Every delta means one thing — this
   *  window vs the adjacent prior window — and `title` states that
   *  comparator on hover so the terse glyph never carries it alone.
   *
   *  Pass this ONLY when the tab's value is a period aggregate AND a
   *  comparable previous-period value exists. Live-state surfaces
   *  (LiveNowView) and categorical tabs (ProjectView) intentionally
   *  omit it - their values aren't period aggregates, so a delta would
   *  be invented data. UsageDetailView uses a placeholder for KPI tabs
   *  whose previous period isn't queryable, so the strip stays visually
   *  uniform without faking unavailable comparisons. */
  delta?: { text: string; color?: string; title?: string };
  /** Opt-in accent color for live data. Omit for historical views. */
  tone?: 'accent' | '';
}

interface Props<T extends string> {
  tabs: ReadonlyArray<StatTabDef<T>>;
  /** Returned by `useTabs(...)` at the call site. */
  tabControl: TabControl<T>;
  /** aria-label for the tablist (e.g. "Project sections"). */
  tablistLabel: string;
  /** Optional id prefix for `aria-controls` wiring. When provided each
   *  tab points at `${idPrefix}-panel-${tab.id}`. */
  idPrefix?: string;
}

/**
 * Canonical "uppercase mono label / large display value" tab row.
 * Single source of truth for ProjectView's hero strip and DetailView's
 * stat strip - both surfaces render the same shape at the same scale.
 *
 * Value font-size is locked at 2.25rem regardless of tab count. Density
 * on narrow viewports is solved by grid wrapping in CSS, not by
 * shrinking typography per count.
 */
export default function StatTabs<T extends string>({
  tabs,
  tabControl,
  tablistLabel,
  idPrefix,
}: Props<T>) {
  const { activeTab, setActiveTab, ref } = tabControl;
  const count = tabs.length;

  return (
    <div
      className={styles.row}
      ref={ref}
      role="tablist"
      aria-label={tablistLabel}
      data-count={count}
    >
      {tabs.map((t, i) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            data-tab={t.id}
            tabIndex={isActive ? 0 : -1}
            className={clsx(styles.button, isActive && styles.active)}
            style={{ '--idx': i } as CSSProperties}
            onClick={(e) => {
              e.currentTarget.focus();
              setActiveTab(t.id);
            }}
          >
            <span className={styles.label}>{t.label}</span>
            <span
              className={clsx(
                styles.value,
                t.variant === 'section' && styles.valueSection,
                t.tone === 'accent' && styles.accent,
              )}
            >
              {t.value}
            </span>
            {t.delta && (
              <span
                className={styles.delta}
                style={t.delta.color ? { color: t.delta.color } : undefined}
                title={t.delta.title}
              >
                {t.delta.text}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export type { TabControl };
