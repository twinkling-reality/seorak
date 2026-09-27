// Browse-and-pick page for the demo scenario catalog. Reads the scenario
// registry, renders it as a filterable table, and activates a scenario by
// writing ?demo=<id> through the existing demoMode helper. The popover
// (DemoSwitcher) is the fast-switch affordance; this view is the
// comprehension affordance for new contributors who don't yet know what
// scenarios exist or which one tests their case.
//
// Design rules:
// - Plain English everywhere. The table is the answer to "which scenario
//   should I switch to" - widget-jargon belongs in code, not here.
// - Column types match the dimensions devs filter on (category, dimensions
//   varied, views affected). No decoration columns.
// - One header, no nested cards. Filter chips are toggle pills above the
//   table; the active filters narrow rows in real time.
// - Row click activates. Avoids a separate "select" button; the whole row
//   is the affordance.

import { useMemo, useState } from 'react';
import ViewHeader from '../../components/ViewHeader/ViewHeader.js';
import {
  DEMO_SCENARIOS,
  DEMO_SCENARIO_IDS,
  DEMO_CATEGORY_ORDER,
  DEMO_CATEGORY_LABELS,
  DEMO_DIMENSION_LABELS,
  DEMO_VIEW_LABELS,
  type DemoScenarioId,
  type DemoCategory,
  type DemoDimension,
  type DemoView as DemoViewKey,
} from '../../lib/demo/index.js';
import { useDemoScenario } from '../../hooks/useDemoScenario.js';
import { isDemoActive, setActiveScenarioId } from '../../lib/demoMode.js';
import styles from './DemoView.module.css';

// The solo dimensions/views. Team-size, pricing, deltas, coordination, memory,
// outcomes-dimension, and the reports/global views were dropped with the team
// scope.
const ALL_DIMENSIONS: DemoDimension[] = [
  'live-presence',
  'cost',
  'capture-depth',
  'intervention',
  'introspection',
  'honesty',
];

const ALL_VIEWS: DemoViewKey[] = [
  'overview',
  'tools',
  'project',
  'compare',
  'replay',
  'model',
];

export default function DemoCatalogView() {
  const { scenarioId } = useDemoScenario();
  const demoOn = isDemoActive();
  const activeId: DemoScenarioId | null = demoOn ? scenarioId : null;

  const [categoryFilter, setCategoryFilter] = useState<DemoCategory | 'all'>('all');
  const [dimensionFilters, setDimensionFilters] = useState<Set<DemoDimension>>(new Set());
  const [viewFilter, setViewFilter] = useState<DemoViewKey | 'all'>('all');
  const [search, setSearch] = useState('');

  const visibleScenarios = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DEMO_SCENARIO_IDS.map((id) => DEMO_SCENARIOS[id]).filter((s) => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (viewFilter !== 'all' && !s.views.includes(viewFilter)) return false;
      if (dimensionFilters.size > 0) {
        let hit = false;
        for (const d of dimensionFilters) {
          if (s.dimensions.includes(d)) {
            hit = true;
            break;
          }
        }
        if (!hit) return false;
      }
      if (q) {
        const hay = `${s.label} ${s.summary} ${s.whatToCheck} ${s.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [categoryFilter, dimensionFilters, viewFilter, search]);

  function toggleDimension(d: DemoDimension) {
    setDimensionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function clearFilters() {
    setCategoryFilter('all');
    setDimensionFilters(new Set());
    setViewFilter('all');
    setSearch('');
  }

  function activate(id: DemoScenarioId) {
    setActiveScenarioId(id);
  }

  const hasActiveFilters =
    categoryFilter !== 'all' ||
    viewFilter !== 'all' ||
    dimensionFilters.size > 0 ||
    search.length > 0;

  return (
    <div className={styles.view}>
      <ViewHeader eyebrow="demo" title="Scenario catalog" demo={demoOn} />
      <p className={styles.lede}>
        Demo states that prove the product jobs (period clarity, away oversight, and
        developer model), plus honest empties. Pick the scenario that matches the claim you
        want to exercise. Activating a row turns demo data on and reroutes every hook to
        that fixture.
      </p>

      <div className={styles.filters}>
        <FilterRow label="Category">
          <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
            All
          </FilterChip>
          {DEMO_CATEGORY_ORDER.map((c) => (
            <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)}>
              {DEMO_CATEGORY_LABELS[c]}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Affects view">
          <FilterChip active={viewFilter === 'all'} onClick={() => setViewFilter('all')}>
            Any view
          </FilterChip>
          {ALL_VIEWS.map((v) => (
            <FilterChip key={v} active={viewFilter === v} onClick={() => setViewFilter(v)}>
              {DEMO_VIEW_LABELS[v]}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Dimension">
          {ALL_DIMENSIONS.map((d) => (
            <FilterChip key={d} active={dimensionFilters.has(d)} onClick={() => toggleDimension(d)}>
              {DEMO_DIMENSION_LABELS[d]}
            </FilterChip>
          ))}
        </FilterRow>

        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search by name, summary, or id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {hasActiveFilters && (
            <button type="button" className={styles.clearBtn} onClick={clearFilters}>
              Clear filters
            </button>
          )}
          <span className={styles.count}>
            {visibleScenarios.length} of {DEMO_SCENARIO_IDS.length}
          </span>
        </div>
      </div>

      {visibleScenarios.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No scenarios match the current filters.</p>
          <button type="button" className={styles.clearBtn} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colName}>Scenario</th>
                <th className={styles.colCategory}>Category</th>
                <th className={styles.colDimensions}>Varies</th>
                <th className={styles.colViews}>Affects</th>
                <th className={styles.colCheck}>What to check</th>
              </tr>
            </thead>
            <tbody>
              {visibleScenarios.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <tr
                    key={s.id}
                    className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                    tabIndex={0}
                    onClick={() => activate(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate(s.id);
                      }
                    }}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <td className={styles.cellName}>
                      <div className={styles.cellNameInner}>
                        <span className={styles.activeDot} aria-hidden="true" />
                        <div className={styles.nameStack}>
                          <span className={styles.nameLabel}>{s.label}</span>
                          <span className={styles.nameSummary}>{s.summary}</span>
                          <span className={styles.nameId}>{s.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.cellCategory}>
                      <span className={styles.categoryTag}>{DEMO_CATEGORY_LABELS[s.category]}</span>
                    </td>
                    <td className={styles.cellDimensions}>
                      {s.dimensions.length === 0 ? (
                        <span className={styles.muted}>baseline</span>
                      ) : (
                        <div className={styles.chipList}>
                          {s.dimensions.map((d) => (
                            <span key={d} className={styles.chip}>
                              {DEMO_DIMENSION_LABELS[d]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={styles.cellViews}>
                      <div className={styles.chipList}>
                        {s.views.map((v) => (
                          <span key={v} className={styles.viewChip}>
                            {DEMO_VIEW_LABELS[v]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={styles.cellCheck}>{s.whatToCheck}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface FilterRowProps {
  label: string;
  children: React.ReactNode;
}

function FilterRow({ label, children }: FilterRowProps) {
  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.chipGroup}>{children}</div>
    </div>
  );
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterChip({ active, onClick, children }: FilterChipProps) {
  return (
    <button
      type="button"
      className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
