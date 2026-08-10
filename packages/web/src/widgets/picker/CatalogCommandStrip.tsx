import clsx from 'clsx';
import type { RefObject } from 'react';

import glass from '../../components/surface/glass.module.css';
import cmd from '../../styles/commandStrip.module.css';

import {
  SHOW_LABELS,
  VIZ_FAMILY_LABELS,
  type ShowFilter,
  type VizFamilyFilter,
} from './catalogFilter.js';

/**
 * The bottom rail: filters on the left, then only the bulk actions that can do
 * something in the current state. Guarded layout actions carry their ⇧ chip
 * in the label, because the modifier IS the guard — there is no confirm step, and
 * the undo behind them lives in the host view's Cmd/Ctrl-Z, not here.
 */
export function CatalogCommandStrip({
  stripRef,
  onClose,
  showFilter,
  onCycleShow,
  vizFilter,
  onCycleViz,
  searchOpen,
  onToggleSearch,
  bulkAddLabel,
  onAddWidgets,
  showClearAll,
  onClearAll,
  onResetToDefault,
}: {
  stripRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  showFilter: ShowFilter;
  onCycleShow: () => void;
  vizFilter: VizFamilyFilter;
  onCycleViz: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  bulkAddLabel: 'Add all' | 'Add matching' | null;
  onAddWidgets: () => void;
  showClearAll: boolean;
  onClearAll: () => void;
  onResetToDefault: () => void;
}) {
  return (
    <div className={clsx(cmd.strip, glass.rim)} ref={stripRef} data-viewport-exclusion="true">
      <button type="button" className={cmd.stripAction} onClick={onClose}>
        Done <kbd className={cmd.kbd}>Esc</kbd>
      </button>
      <span className={cmd.stripDivider} />
      <button
        type="button"
        className={clsx(cmd.stripAction, showFilter !== 'all' && cmd.stripActionActive)}
        onClick={onCycleShow}
      >
        Show: {SHOW_LABELS[showFilter]} <kbd className={cmd.kbd}>Tab</kbd>
      </button>
      <span className={cmd.stripDivider} />
      <button
        type="button"
        className={clsx(cmd.stripAction, vizFilter !== 'all' && cmd.stripActionActive)}
        onClick={onCycleViz}
      >
        Type: {VIZ_FAMILY_LABELS[vizFilter]} <kbd className={cmd.kbd}>T</kbd>
      </button>
      <span className={cmd.stripDivider} />
      <button
        type="button"
        className={clsx(cmd.stripAction, searchOpen && cmd.stripActionActive)}
        onClick={onToggleSearch}
      >
        Search <kbd className={cmd.kbd}>/</kbd>
      </button>
      {bulkAddLabel && (
        <>
          <span className={cmd.stripDivider} />
          <button type="button" className={cmd.stripAction} onClick={onAddWidgets}>
            {bulkAddLabel}
            <span className={cmd.kbdGroup}>
              <kbd className={cmd.kbd}>⇧</kbd>
              <kbd className={cmd.kbd}>A</kbd>
            </span>
          </button>
        </>
      )}
      {showClearAll && (
        <>
          <span className={cmd.stripDivider} />
          <button type="button" className={cmd.stripAction} onClick={onClearAll}>
            Empty dashboard
            <span className={cmd.kbdGroup}>
              <kbd className={cmd.kbd}>⇧</kbd>
              <kbd className={cmd.kbd}>C</kbd>
            </span>
          </button>
        </>
      )}
      <span className={cmd.stripDivider} />
      <button type="button" className={cmd.stripAction} onClick={onResetToDefault}>
        Restore default
        <span className={cmd.kbdGroup}>
          <kbd className={cmd.kbd}>⇧</kbd>
          <kbd className={cmd.kbd}>V</kbd>
        </span>
      </button>
    </div>
  );
}
