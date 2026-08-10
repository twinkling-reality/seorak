import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';

import { getWidget, type WidgetDef } from './catalog/index.js';
import { navigateToAgents, navigateToDetail } from '../lib/router.js';
import { isPickerAddBlocked } from '../lib/widgetReadiness.js';
import { CatalogCategoryBar } from './picker/CatalogCategoryBar.js';
import { CatalogCommandStrip } from './picker/CatalogCommandStrip.js';
import { CatalogRow } from './picker/CatalogRow.js';
import { CatalogSearchBar } from './picker/CatalogSearchBar.js';
import { CatalogTooltip } from './picker/CatalogTooltip.js';
import {
  categoryCounts,
  CATEGORY_CYCLE,
  cycle,
  filterWidgets,
  scopeCatalog,
  SHOW_CYCLE,
  VIZ_FAMILY_CYCLE,
  type CategoryFilter,
  type ShowFilter,
  type VizFamilyFilter,
} from './picker/catalogFilter.js';
import { catalogHotkeyAction } from './picker/catalogHotkeys.js';
import {
  tooltipPlacement,
  TOOLTIP_FALLBACK_HEIGHT,
  TOOLTIP_WIDTH,
} from './picker/tooltipPlacement.js';
import styles from './WidgetCatalog.module.css';
import cmd from '../styles/commandStrip.module.css';
import glass from '../components/surface/glass.module.css';

/**
 * WidgetCatalog — the customize surface, and the only stateful piece of the picker.
 *
 * Everything it can decide without the DOM lives in `picker/` as plain modules:
 * which rows show (catalogFilter), what a keystroke means (catalogHotkeys), where
 * the hover card lands (tooltipPlacement), how the specimen is scaled
 * (previewLayout), and what the drag hands the grid (catalogDrag). What is left
 * here is genuinely stateful: the filter state, the measured rects the floating
 * card is positioned against, the scroll-fade observers, and the window-level
 * keyboard binding.
 */
export function WidgetCatalog({
  open,
  onClose,
  widgetIds,
  toggleWidget,
  onAddWidgets,
  resetToDefault,
  clearAll,
  viewScope,
  overview,
  capture,
}: {
  open: boolean;
  onClose: () => void;
  widgetIds: string[];
  toggleWidget: (id: string) => void;
  /** Returns the identities the host actually appended. */
  onAddWidgets: (ids: string[]) => readonly string[];
  resetToDefault: () => void;
  clearAll: () => void;
  /** Which view is hosting the picker. Filters catalog to scope-matching widgets. */
  viewScope?: 'overview' | 'project';
  overview?: OverviewSnapshot | null;
  capture?: CaptureSettings | null;
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');
  const [vizFilter, setVizFilter] = useState<VizFamilyFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);
  const [displayWidgetId, setDisplayWidgetId] = useState<string | null>(null);
  const [displayPos, setDisplayPos] = useState<{ y: number } | null>(null);
  const [panelRect, setPanelRect] = useState<DOMRect | null>(null);
  const [stripRect, setStripRect] = useState<DOMRect | null>(null);
  const [tooltipSize, setTooltipSize] = useState({
    width: TOOLTIP_WIDTH,
    height: TOOLTIP_FALLBACK_HEIGHT,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [listFade, setListFade] = useState<'none' | 'top' | 'bottom' | 'both'>('none');

  // Reset state on open
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setActiveCategory('all');
    setShowFilter('all');
    setVizFilter('all');
    setSearchOpen(false);
    setSearchQuery('');
    setHoveredWidgetId(null);
    setDisplayWidgetId(null);
    setDisplayPos(null);
  }
  if (open !== lastOpen) setLastOpen(open);

  const measureFloatingRects = useCallback(() => {
    setPanelRect(panelRef.current?.getBoundingClientRect() ?? null);
    setStripRect(stripRef.current?.getBoundingClientRect() ?? null);
  }, []);

  // Focus search when opened
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  // Reset scroll on filter changes
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activeCategory, searchQuery, showFilter, vizFilter]);

  const updateListFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const canUp = el.scrollTop > 0;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setListFade(canUp && canDown ? 'both' : canUp ? 'top' : canDown ? 'bottom' : 'none');
  }, []);

  const scopedCatalog = useMemo(() => scopeCatalog(viewScope), [viewScope]);

  const filteredWidgets = useMemo(
    () =>
      filterWidgets(scopedCatalog, {
        activeCategory,
        showFilter,
        vizFilter,
        searchQuery,
        widgetIds,
      }),
    [searchQuery, activeCategory, showFilter, vizFilter, widgetIds, scopedCatalog],
  );

  const addableWidgetIds = useMemo(
    () =>
      filteredWidgets
        .filter(
          (widget) =>
            !widgetIds.includes(widget.id) && !isPickerAddBlocked(widget.id, capture),
        )
        .map((widget) => widget.id),
    [capture, filteredWidgets, widgetIds],
  );

  const filtersAreUnnarrowed =
    activeCategory === 'all' &&
    showFilter === 'all' &&
    vizFilter === 'all' &&
    searchQuery.trim() === '';

  const bulkAddLabel = addableWidgetIds.length === 0
    ? null
    : filtersAreUnnarrowed
      ? 'Add all'
      : 'Add matching';

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(measureFloatingRects);
    window.addEventListener('resize', measureFloatingRects);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measureFloatingRects);
    };
  }, [open, filteredWidgets.length, searchOpen, measureFloatingRects]);

  const counts = useMemo(() => categoryCounts(scopedCatalog), [scopedCatalog]);

  // Briefly fade the panel + strip on add so the user's eye, which is
  // already parked on the catalog, can see through to the widget pulsing
  // into place on the canvas underneath. The low-opacity hold is sized to
  // overlap the WidgetGrid borderSweep window (which itself defers ~450ms
  // when a scrollIntoView is needed).
  const triggerReveal = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const keyframes: Keyframe[] = [
      { opacity: 1, offset: 0 },
      { opacity: 0.3, offset: 0.15 },
      { opacity: 0.3, offset: 0.7 },
      { opacity: 1, offset: 1 },
    ];
    const opts: KeyframeAnimationOptions = { duration: 1400, easing: 'ease-out' };
    panelRef.current?.animate(keyframes, opts);
    stripRef.current?.animate(keyframes, opts);
  }, []);

  // Wraps the parent toggle to detect adds (id not currently active) and
  // trigger the reveal. Removes intentionally do not reveal — there is
  // nothing to look at on the canvas.
  const handleToggle = useCallback(
    (id: string) => {
      const wasInactive = !widgetIds.includes(id);
      toggleWidget(id);
      if (wasInactive) triggerReveal();
    },
    [widgetIds, toggleWidget, triggerReveal],
  );

  const handleAddWidgets = useCallback(() => {
    if (addableWidgetIds.length === 0) return;
    if (onAddWidgets(addableWidgetIds).length > 0) triggerReveal();
  }, [addableWidgetIds, onAddWidgets, triggerReveal]);

  // Open a widget's drill surface from the picker. Closes the panel first so
  // the detail doesn't stack under the customize chrome; history back returns
  // to the cockpit. Mirrors WidgetRenderer's openDrill branch exactly.
  const openDrill = useCallback(
    (widget: WidgetDef) => {
      const drill = widget.drillTarget;
      if (!drill) return;
      onClose();
      if ('route' in drill && drill.route === 'agents') {
        navigateToAgents(drill.section);
        return;
      }
      if ('view' in drill && drill.view) {
        navigateToDetail(drill.view, drill.tab, drill.q);
      }
    },
    [onClose],
  );

  const cycleShowFilter = useCallback(() => {
    setShowFilter((prev) => cycle(SHOW_CYCLE, prev));
  }, []);

  const cycleVizFilter = useCallback(() => {
    setVizFilter((prev) => cycle(VIZ_FAMILY_CYCLE, prev));
  }, []);

  const cycleCategory = useCallback((dir: 1 | -1) => {
    setActiveCategory((prev) => cycle(CATEGORY_CYCLE, prev, dir));
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) return false;
      setSearchQuery('');
      return true;
    });
  }, []);

  // Hover handler
  const handleRowHover = useCallback((widgetId: string | null, rowElement?: HTMLElement) => {
    setHoveredWidgetId(widgetId);
    if (widgetId && rowElement) {
      measureFloatingRects();
      const rect = rowElement.getBoundingClientRect();
      setDisplayWidgetId(widgetId);
      setDisplayPos({ y: rect.top + rect.height / 2 });
    }
  }, [measureFloatingRects]);

  useEffect(() => {
    if (!displayWidgetId) return;
    const el = tooltipRef.current;
    if (!el) return;
    const update = () =>
      setTooltipSize({
        width: el.offsetWidth || TOOLTIP_WIDTH,
        height: el.offsetHeight || TOOLTIP_FALLBACK_HEIGHT,
      });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [displayWidgetId]);

  // Subscribe to list/content size changes via ResizeObserver. RO fires
  // immediately on observe() and again whenever the list or its children
  // resize, so fade state stays in sync without calling setState directly
  // from the effect body. Re-attaches when the filter/content set changes.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => updateListFade());
    obs.observe(el);
    for (const child of Array.from(el.children)) obs.observe(child);
    return () => obs.disconnect();
  }, [open, updateListFade, filteredWidgets.length]);

  const tooltipStyle = useMemo(
    () =>
      tooltipPlacement({
        displayY: displayPos?.y ?? null,
        panelLeft: panelRect?.left ?? null,
        stripTop: stripRect?.top ?? null,
        tooltipWidth: tooltipSize.width,
        tooltipHeight: tooltipSize.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }) as CSSProperties,
    [displayPos, panelRect, stripRect, tooltipSize],
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const action = catalogHotkeyAction(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          inTextInput: e.target instanceof HTMLInputElement,
        },
        {
          canClearAll: widgetIds.length > 0,
          canAddWidgets: addableWidgetIds.length > 0,
        },
      );
      if (!action) return;
      switch (action.type) {
        case 'close-search':
          setSearchOpen(false);
          setSearchQuery('');
          break;
        case 'close':
          onClose();
          break;
        case 'reset-to-default':
          resetToDefault();
          break;
        case 'clear-all':
          clearAll();
          break;
        case 'add-widgets':
          handleAddWidgets();
          break;
        case 'toggle-search':
          toggleSearch();
          break;
        case 'cycle-show':
          cycleShowFilter();
          break;
        case 'cycle-viz':
          cycleVizFilter();
          break;
        case 'cycle-category':
          cycleCategory(action.dir);
          break;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    onClose,
    resetToDefault,
    clearAll,
    handleAddWidgets,
    widgetIds.length,
    addableWidgetIds.length,
    toggleSearch,
    cycleShowFilter,
    cycleVizFilter,
    cycleCategory,
  ]);

  if (!open) return null;

  const showTooltip = !!hoveredWidgetId;
  const displayWidget = displayWidgetId ? getWidget(displayWidgetId) : null;

  return createPortal(
    <>
      {/* ── Search bar (above panel, invoked with /) ── */}
      {searchOpen && (
        <CatalogSearchBar inputRef={searchRef} value={searchQuery} onChange={setSearchQuery} />
      )}

      {/* ── Widget Panel ── */}
      <div
        className={clsx(styles.panel, glass.sheetStrong)}
        ref={panelRef}
        data-viewport-exclusion="true"
      >
        <CatalogCategoryBar
          activeCategory={activeCategory}
          counts={counts}
          onPick={setActiveCategory}
          onCycle={cycleCategory}
        />

        {/* Widget list */}
        <div
          className={clsx(
            styles.panelList,
            listFade === 'top' && cmd.listFadeTop,
            listFade === 'bottom' && cmd.listFadeBottom,
            listFade === 'both' && cmd.listFadeBoth,
          )}
          ref={listRef}
          onScroll={updateListFade}
        >
          {filteredWidgets.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyText}>No widgets match.</span>
            </div>
          ) : (
            filteredWidgets.map((w) => {
              const active = widgetIds.includes(w.id);
              return (
                <CatalogRow
                  key={w.id}
                  widget={w}
                  active={active}
                  onToggle={() => handleToggle(w.id)}
                  onHover={(el) => handleRowHover(w.id, el)}
                  onHoverEnd={() => handleRowHover(null)}
                  onOpenDetail={w.drillTarget ? () => openDrill(w) : undefined}
                  overview={overview}
                  capture={capture}
                />
              );
            })
          )}
        </div>
      </div>

      {/* ── Hover Tooltip (left of panel) ── */}
      {displayWidget && (
        <CatalogTooltip
          widget={displayWidget}
          onBoard={widgetIds.includes(displayWidget.id)}
          overview={overview}
          capture={capture}
          style={tooltipStyle}
          visible={showTooltip}
          tooltipRef={tooltipRef}
        />
      )}

      {/* ── Command Strip ── */}
      <CatalogCommandStrip
        stripRef={stripRef}
        onClose={onClose}
        showFilter={showFilter}
        onCycleShow={cycleShowFilter}
        vizFilter={vizFilter}
        onCycleViz={cycleVizFilter}
        searchOpen={searchOpen}
        onToggleSearch={toggleSearch}
        bulkAddLabel={bulkAddLabel}
        onAddWidgets={handleAddWidgets}
        showClearAll={widgetIds.length > 0}
        onClearAll={clearAll}
        onResetToDefault={resetToDefault}
      />
    </>,
    document.body,
  );
}
