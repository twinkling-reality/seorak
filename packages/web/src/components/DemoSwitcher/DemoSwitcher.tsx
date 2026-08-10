// Demo data picker. Mirrors `WidgetCatalog`:
// - Trigger pill at top-right (catalog mirrors at bottom-right).
// - Panel anchored to the trigger.
// - Bottom command strip inside the panel with mono actions + kbd chips,
//   matching the catalog's strip exactly.
// - Search is opt-in (`/`), and appears as a separate floating bar
//   anchored to the panel's outside edge (below the panel, away from
//   the trigger — same topology as the catalog where search appears
//   above its panel).
// - Visible only when ?demo is in the URL or in dev builds.

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import cmd from '../../styles/commandStrip.module.css';
import { useDemoScenario } from '../../hooks/useDemoScenario.js';
import {
  DEMO_SCENARIOS,
  DEMO_SCENARIO_IDS,
  DEMO_CATEGORY_ORDER,
  DEMO_CATEGORY_LABELS,
  type DemoScenario,
  type DemoScenarioId,
  type DemoCategory,
} from '../../lib/demo/index.js';
import { isDemoActive, setActiveScenarioId, shouldShowDemoSwitcher } from '../../lib/demoMode.js';
import { navigate } from '../../lib/router.js';
import styles from './DemoSwitcher.module.css';
import glass from '../surface/glass.module.css';

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export default function DemoSwitcher() {
  const { scenarioId } = useDemoScenario();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(() => shouldShowDemoSwitcher());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handler() {
      setVisible(shouldShowDemoSwitcher());
    }
    window.addEventListener('seorak:demo-scenario-changed', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('seorak:demo-scenario-changed', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  // Click outside trigger + panel + search closes everything.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      if (searchRef.current?.parentElement?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  // Hotkeys mirror the catalog: D toggles, / opens search, Esc closes
  // (search first if open, then panel), arrow keys navigate, O toggles
  // demo on/off, B opens catalog.
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (open && e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          setSearch('');
        } else {
          setOpen(false);
        }
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!open) {
        if (isTextTarget(e.target)) return;
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }
      // Arrow keys must always navigate the list, even from inside the
      // search input. Other keys typed into the input go to the input.
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => i + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setSearchOpen((p) => {
          const next = !p;
          if (!next) setSearch('');
          return next;
        });
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (isDemoActive()) {
          setActiveScenarioId(null);
        } else {
          setActiveScenarioId(scenarioId);
        }
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setOpen(false);
        navigate('demo');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => i + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, open, searchOpen, scenarioId]);

  function openPanel() {
    setSearchOpen(false);
    setSearch('');
    setActiveIndex(0);
    setOpen(true);
  }

  // Focus the search input when the search bar opens.
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [searchOpen]);

  const activeInUrl = isDemoActive();
  const active = DEMO_SCENARIOS[scenarioId];

  const filtered: DemoScenario[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DEMO_SCENARIO_IDS.map((id) => DEMO_SCENARIOS[id])
      .filter((s) => {
        if (!q) return true;
        const hay =
          `${s.label} ${s.summary} ${s.id} ${DEMO_CATEGORY_LABELS[s.category]}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const ai = DEMO_CATEGORY_ORDER.indexOf(a.category);
        const bi = DEMO_CATEGORY_ORDER.indexOf(b.category);
        if (ai !== bi) return ai - bi;
        return DEMO_SCENARIO_IDS.indexOf(a.id) - DEMO_SCENARIO_IDS.indexOf(b.id);
      });
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<DemoCategory, DemoScenario[]>();
    for (const s of filtered) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return DEMO_CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      scenarios: map.get(c)!,
    }));
  }, [filtered]);

  type FlatRow = { kind: 'off' } | { kind: 'scenario'; scenario: DemoScenario };
  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [{ kind: 'off' }];
    for (const s of filtered) rows.push({ kind: 'scenario', scenario: s });
    return rows;
  }, [filtered]);

  const clampedIndex =
    flatRows.length === 0 ? 0 : Math.min(Math.max(0, activeIndex), flatRows.length - 1);

  const flatIndexById = new Map<string, number>();
  flatRows.forEach((r, i) => {
    if (r.kind === 'off') flatIndexById.set('__off__', i);
    else flatIndexById.set(r.scenario.id, i);
  });

  if (!visible) return null;

  function selectScenario(id: DemoScenarioId) {
    setActiveScenarioId(id);
  }

  function turnOff() {
    setActiveScenarioId(null);
  }

  function activateAtIndex(idx: number) {
    const r = flatRows[idx];
    if (!r) return;
    if (r.kind === 'off') turnOff();
    else selectScenario(r.scenario.id);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={clsx(styles.trigger, glass.sheet, glass.rim)}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {activeInUrl ? `Demo: ${active.label}` : 'Demo: off'}
      </button>

      {open &&
        createPortal(
          <>
            <div
              ref={panelRef}
              className={clsx(styles.panel, glass.sheetStrong)}
              role="dialog"
              aria-label="Demo data scenarios"
            >
              <div className={styles.list}>
                {(() => {
                  const idx = flatIndexById.get('__off__') ?? 0;
                  const isHighlighted = idx === clampedIndex;
                  const isActive = !activeInUrl;
                  return (
                    <button
                      type="button"
                      className={`${styles.row} ${isHighlighted ? styles.rowHighlighted : ''} ${
                        isActive ? styles.rowActive : ''
                      }`}
                      onClick={turnOff}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <span className={styles.rowName}>Off</span>
                      <span className={styles.rowDesc}>Use real data</span>
                    </button>
                  );
                })()}

                {grouped.length === 0 && search.length > 0 ? (
                  <div className={styles.empty}>No scenarios match.</div>
                ) : (
                  grouped.map(({ category, scenarios }) => (
                    <section key={category}>
                      <div className={styles.sectionLabel}>{DEMO_CATEGORY_LABELS[category]}</div>
                      {scenarios.map((s) => {
                        const idx = flatIndexById.get(s.id) ?? -1;
                        const isHighlighted = idx === clampedIndex;
                        const isActive = activeInUrl && s.id === scenarioId;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`${styles.row} ${
                              isHighlighted ? styles.rowHighlighted : ''
                            } ${isActive ? styles.rowActive : ''}`}
                            onClick={() => selectScenario(s.id)}
                            onMouseEnter={() => setActiveIndex(idx)}
                          >
                            <span className={styles.rowName}>{s.label}</span>
                            <span className={styles.rowDesc}>{s.summary}</span>
                          </button>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>

              <div className={styles.strip}>
                <button type="button" className={cmd.stripAction} onClick={() => setOpen(false)}>
                  Done <kbd className={cmd.kbd}>Esc</kbd>
                </button>
                <span className={cmd.stripDivider} />
                <button
                  type="button"
                  className={clsx(cmd.stripAction, searchOpen && cmd.stripActionActive)}
                  onClick={() => {
                    setSearchOpen((p) => {
                      const next = !p;
                      if (!next) setSearch('');
                      return next;
                    });
                  }}
                >
                  Search <kbd className={cmd.kbd}>/</kbd>
                </button>
                <span className={cmd.stripDivider} />
                <button
                  type="button"
                  className={clsx(cmd.stripAction, activeInUrl && cmd.stripActionActive)}
                  onClick={() => (activeInUrl ? turnOff() : selectScenario(scenarioId))}
                >
                  {activeInUrl ? 'Turn off' : 'Turn on'} <kbd className={cmd.kbd}>O</kbd>
                </button>
                <span className={cmd.stripDivider} />
                <button
                  type="button"
                  className={cmd.stripAction}
                  onClick={() => {
                    setOpen(false);
                    navigate('demo');
                  }}
                >
                  Catalog <kbd className={cmd.kbd}>B</kbd>
                </button>
              </div>
            </div>

            {searchOpen && (
              <div className={clsx(cmd.searchBar, styles.demoSearchBar, glass.sheet, glass.rim)}>
                <input
                  ref={searchRef}
                  type="text"
                  className={cmd.searchInput}
                  placeholder="Search scenarios"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      activateAtIndex(clampedIndex);
                    }
                  }}
                />
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
