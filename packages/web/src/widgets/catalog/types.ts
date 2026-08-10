import type { AgentsSectionId, DetailViewKey } from '../../lib/router.js';

/**
 * What SEORAK must be capturing for a widget to fill. Not a tool capability.
 *
 * These name our own collection machinery (`hooks` are our hook handlers,
 * `commitTracking` is the daemon's git sweep), so they answer "are we collecting
 * this?", never "can the agent report this?". The three axes are distinct and
 * collapsing them is the bug class the capability contract exists to kill:
 *
 *   1. tool capability   — what the agent CAN report (`@seorak/types`
 *                          SessionCapabilities; resolved worker-side, gates the
 *                          aggregate to null before it ever reaches the web)
 *   2. capture setting   — what we are collecting (`CaptureSettings`, THIS type)
 *   3. data presence     — what actually arrived (a null field on the snapshot)
 *
 * It was previously called `DataCapabilities` and typed as an interface that no
 * value ever satisfied, which made "capability" mean two different things in one
 * codebase. A union says what it is: a name, not a flag someone forgot to set.
 */
export type CaptureRequirement = 'tokenUsage' | 'toolCallLogs' | 'commitTracking' | 'hooks';

/**
 * Widget catalog types: every data point that can appear on the overview.
 *
 * 12-column band layout. Each widget declares `w` (columns it spans:
 * 3/4/6/8/12) and `h` (80px row units, its minimum height). WidgetGrid
 * partitions widgets in order into visual rows ("bands") of up to 12
 * columns; every widget in a band stretches to the band's tallest member,
 * so widget tops and bottoms always align — staggered layouts are
 * structurally impossible regardless of which heights sit side by side.
 * Bands also break when `rowSpan` tier changes (a rowSpan-2 KPI never
 * shares a row with a rowSpan-3 chart just because columns still fit).
 *
 * Sizes:
 *   KPI stat card:    3 cols × 2 rows  (quarter width, compact)
 *   Enriched stat:    4 cols × 2 rows  (third width)
 *   Half chart:       6 cols × 3 rows  (half width, standard chart)
 *   Wide chart:       8 cols × 3 rows  (two-thirds)
 *   Full-width:      12 cols × 3 rows  (tables, timelines)
 *   Tall full-width: 12 cols × 4 rows  (heatmap, large viz)
 */

export type WidgetColSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetRowSpan = 2 | 3 | 4 | 5 | 6;

/**
 * Layout slot persisted in localStorage. `colSpan` maps to grid-column:span;
 * `rowSpan` sets the cell's minimum height in 80px row units with 24px gaps,
 * so a rowSpan of 2 floors the widget at 184px, 3 = 288px, 4 = 392px. The
 * cell grows past its floor when a band-mate is taller (band equalization).
 */
export interface WidgetSlot {
  id: string;
  colSpan: WidgetColSpan;
  rowSpan: WidgetRowSpan;
}

// The canonical visualization vocabulary (DASHBOARD-CLARITY.md, Precedent 2):
// one form per data shape. Six previously-declared types (stat-row,
// multi-sparkline, outcome-bar, factual-grid, topic-bars, bucket-chart) had
// zero catalog uses and were removed. Bodies render by widget id, so this field
// only drives the `data-widget-viz` attribute (CSS centering + empty states).
export type WidgetViz =
  | 'stat'
  | 'sparkline'
  | 'heatmap'
  | 'bar-chart'
  | 'proportional-bar'
  | 'data-list'
  | 'ring'
  | 'project-list'
  | 'live-list';

export type WidgetCategory =
  | 'live'
  | 'usage'
  | 'outcomes'
  | 'activity'
  | 'codebase'
  | 'tools';

/**
 * Time-semantics bucket. Drives whether a widget responds to the global date
 * picker and what label, if any, appears in its header.
 *
 *   'period'   = every number responds to the picker (default, most widgets)
 *   'live'     = real-time snapshot, picker does not apply
 *   'all-time' = lifetime values, picker does not apply
 *
 * A widget is exactly one scope. If a design needs mixed scopes, split it
 * into two widgets so users can tell which numbers the picker controls.
 */
export type WidgetTimeScope = 'period' | 'live' | 'all-time';

/**
 * Which view surfaces a widget should appear in:
 *   'overview'  — cross-project / developer-level scope only
 *   'project'   — single-project scope only
 *   'both'      — renders correctly at either scope
 * Used by the picker to filter catalog entries per view.
 */
export type WidgetScope = 'overview' | 'project' | 'both';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  scope: WidgetScope;
  viz: WidgetViz;
  /** Default width in grid columns (1-12) */
  w: number;
  /** Default height in row units (~80px each) */
  h: number;
  /** Minimum width */
  minW?: number;
  /** Minimum height */
  minH?: number;
  /** Maximum width */
  maxW?: number;
  /** Maximum height */
  maxH?: number;
  /**
   * Keys naming the data sources this widget reads. NOT a gate: availability is
   * driven by `availability` + `requiresCapture` + the widgetReadinessProbes
   * (see `widgetReadiness`), never by this field. It only labels the picker
   * tooltip and documents intent, so an inaccurate key can never silently hide
   * or show a tile.
   */
  dataKeys: string[];
  /**
   * Time-semantics scope. Omit for the default ('period') — only set
   * explicitly for 'live' or 'all-time' widgets. See WidgetTimeScope.
   */
  timeScope?: WidgetTimeScope;
  /**
   * When true, the widget's cell carries no authored min-height: its
   * natural content height is its contribution to the band, so a sparse
   * widget (quiet live board, short list) collapses instead of reserving
   * empty vertical space. Sharing a band with a taller widget stretches it
   * to the band height like any other member, so alignment is never
   * affected. Best for widgets that are commonly sparse (live presence,
   * list overflow); charts with intrinsic proportions should keep a fixed
   * floor. Bodies cap their own data (e.g. LIVE_AGENTS_CAP + overflow rows)
   * since an uncapped list grows its band.
   */
  fitContent?: boolean;
  /**
   * Click drill destination for the cockpit widget surface. When set,
   * `WidgetRenderer` wraps the body in a clickable affordance that opens
   * either a detail drill (`navigateToDetail`) or the Agents route
   * (`navigateToAgents`).
   */
  drillTarget?:
    | { view: DetailViewKey; tab: string; q?: string }
    | { route: 'agents'; section: AgentsSectionId };
  /**
   * The widget body wires its own click affordance — either an inline
   * `StatWidget` with `onOpenDetail`, or a table whose rows are buttons
   * with their own `View` pill. When true, `WidgetRenderer` skips the
   * outer `widgetBodyClickable` wrapper so we don't double-stack drill
   * affordances (full-container hover background + ↗ corner arrow on
   * top of an already-clickable body). The principle: full-container
   * hover is reserved for vizzes whose drill target is otherwise
   * unclear (single chart, heatmap). Tables and stat-with-deltas have
   * their own obvious click target and don't need it.
   */
  ownsClick?: boolean;
  /**
   * What Seorak must be CAPTURING for this widget to populate fully. Read by
   * `widgetReadiness` to resolve which capture toggle gates the widget (the
   * "no dead controls" rule). Whether the agent could report it in the first
   * place is a separate question, settled worker-side before the data ships.
   */
  requiresCapture?: CaptureRequirement;
  /**
   * Whether Seorak can feed this widget yet. Omit for widgets bound to data
   * Seorak already captures ('available' is the default). Set explicitly on
   * locked tiles the picker should visibly flag so a user can see they cannot
   * be fed:
   *   'not-available' — Seorak does not collect this data and has no plan to
   *                     in v1 (file paths, lines, commits, directories).
   *   'coming-soon'   — the data is on the roadmap (event log, stuck engine,
   *                     per-model attribution) and the tile fills in once it
   *                     lands.
   * The picker reads this to paint a small honest badge on the row.
   */
  availability?: 'available' | 'not-available' | 'coming-soon';
}

function clampColSpan(n: number): WidgetColSpan {
  if (n <= 3) return 3;
  if (n === 4) return 4;
  if (n <= 6) return 6;
  if (n <= 8) return 8;
  return 12;
}

export function clampRowSpan(n: number): WidgetRowSpan {
  if (n <= 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  if (n === 5) return 5;
  return 6;
}

/**
 * Resolve a widget's default column span for the CSS Grid layout. Maps the
 * catalog's `w` (RGL grid units) to one of the canonical spans 3/4/6/8/12.
 * Used by views that render widgets via grid-column:span.
 */
export function widgetColSpan(def: WidgetDef): WidgetColSpan {
  return clampColSpan(def.w);
}

/**
 * Resolve a widget's default row span for the CSS Grid layout. Maps the
 * catalog's `h` (80px units) to one of 2/3/4 row spans.
 */
export function widgetRowSpan(def: WidgetDef): WidgetRowSpan {
  return clampRowSpan(def.h);
}
