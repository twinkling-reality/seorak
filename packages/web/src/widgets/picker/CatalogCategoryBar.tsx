import clsx from 'clsx';

import glass from '../../components/surface/glass.module.css';
import { CATEGORIES } from '../catalog/index.js';
import styles from '../WidgetCatalog.module.css';

import { CAT_ICONS, CatalogChevronLeft, CatalogChevronRight } from './CatalogIcons.js';
import type { CategoryFilter } from './catalogFilter.js';

/** Category icons with arrow nav. A category with nothing in the current scope is
 *  not rendered at all, so a pill can never open onto an empty list. */
export function CatalogCategoryBar({
  activeCategory,
  counts,
  onPick,
  onCycle,
}: {
  activeCategory: CategoryFilter;
  counts: Record<string, number>;
  onPick: (category: CategoryFilter) => void;
  onCycle: (dir: 1 | -1) => void;
}) {
  return (
    <div className={styles.panelCats}>
      <button type="button" className={styles.panelCatArrow} onClick={() => onCycle(-1)}>
        <CatalogChevronLeft />
      </button>
      <button
        type="button"
        className={clsx(
          styles.panelCat,
          activeCategory === 'all' && styles.panelCatActive,
          activeCategory === 'all' && glass.rim,
        )}
        onClick={() => onPick('all')}
        data-label="All"
      >
        <span className={styles.panelCatIcon}>{CAT_ICONS.all}</span>
      </button>
      {CATEGORIES.map((cat) => {
        const n = counts[cat.id] ?? 0;
        if (n === 0) return null;
        return (
          <button
            key={cat.id}
            type="button"
            className={clsx(
              styles.panelCat,
              activeCategory === cat.id && styles.panelCatActive,
              activeCategory === cat.id && glass.rim,
            )}
            onClick={() => onPick(cat.id)}
            data-label={cat.label}
          >
            <span className={styles.panelCatIcon}>{CAT_ICONS[cat.id] ?? CAT_ICONS.all}</span>
          </button>
        );
      })}
      <button type="button" className={styles.panelCatArrow} onClick={() => onCycle(1)}>
        <CatalogChevronRight />
      </button>
    </div>
  );
}
