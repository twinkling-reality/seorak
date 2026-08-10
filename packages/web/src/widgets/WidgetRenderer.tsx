import { memo, useCallback, useContext, useState, type KeyboardEvent } from 'react';
import SectionTitle from '../components/SectionTitle/SectionTitle.js';
import SectionEmpty from '../components/SectionEmpty/SectionEmpty.js';
import {
  EmptyWidgetContext,
  WidgetChromeContext,
  WidgetControls,
} from '../components/WidgetGrid/WidgetGrid.js';
import styles from './WidgetRenderer.module.css';
import { getWidget } from './catalog/index.js';
import { widgetBodies } from './bodies/registry.js';
import { navigateToAgents, navigateToDetail } from '../lib/router.js';
import type { WidgetBodyProps } from './bodies/types.js';

interface WidgetRendererProps extends WidgetBodyProps {
  widgetId: string;
}

function WidgetRendererInner({ widgetId, overview, ...bodyProps }: WidgetRendererProps) {
  const def = getWidget(widgetId);
  const drill = def?.drillTarget;

  // Track whether the body is currently in empty state. SectionEmpty
  // signals this through EmptyWidgetContext; we keep a local copy to
  // decide whether to wrap the body in the outer drill affordance, and
  // forward the same signal up to the enclosing grid cell so its row
  // span continues to collapse on empty.
  const outerSetEmpty = useContext(EmptyWidgetContext);
  const chrome = useContext(WidgetChromeContext);
  const [bodyEmpty, setBodyEmptyLocal] = useState(false);
  const chainedSetEmpty = useCallback(
    (v: boolean) => {
      setBodyEmptyLocal(v);
      outerSetEmpty?.(v);
    },
    [outerSetEmpty],
  );

  // Wrap the body in an outer click affordance only when the body doesn't
  // already own its drill. Tables with per-row View buttons and stats with
  // inline `onOpenDetail` set `ownsClick: true` in the catalog so the
  // wrapper's full-container hover and ↗ corner arrow don't stack on top
  // of an already-clickable interior. See `WidgetDef.ownsClick`.
  // Exception: when an ownsClick body is empty there's nothing inside to
  // click, so the wrapper temporarily takes over so the drill stays
  // reachable. Switches back to bare rendering the moment data arrives.
  // Caveat: only bodies that render <SectionEmpty> flip bodyEmpty (through
  // EmptyWidgetContext). An ownsClick STAT that empties via ReadinessStatEmpty
  // ("--") does NOT signal empty, so it stays inert when empty instead of
  // wrapper-drillable. That is the honest behavior anyway: its drill target is
  // an empty panel, so there is nothing to reach.
  const wrapClick = !!drill && (!def?.ownsClick || bodyEmpty);

  const openDrill = useCallback(() => {
    if (!drill) return;
    if ('route' in drill && drill.route === 'agents') {
      navigateToAgents(drill.section);
      return;
    }
    if ('view' in drill && drill.view) {
      navigateToDetail(drill.view, drill.tab, drill.q);
    }
  }, [drill]);

  const handleClick = useCallback(() => {
    openDrill();
  }, [openDrill]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!drill) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDrill();
      }
    },
    [drill, openDrill],
  );

  if (!def) return null;
  const Body = widgetBodies[widgetId];
  const body = Body ? (
    <Body overview={overview} {...bodyProps} />
  ) : (
    <SectionEmpty>Unknown widget</SectionEmpty>
  );

  // Bodies own their capability disclosure and only paint it where it's
  // load-bearing (empty states that would be opaque without it).
  // Partial-capture across the catalog lives on a dedicated data-quality
  // surface, not stacked under every capability-gated stat card.

  // Single body container with attributes toggled by wrapClick so the
  // subtree doesn't unmount/remount when an ownsClick widget flips
  // between empty (wrapped) and populated (bare).
  return (
    <>
      <div className={styles.widgetHead} data-widget-zone="head">
        <div className={styles.widgetHeadTitle}>
          <SectionTitle>{def.name}</SectionTitle>
        </div>
        {chrome ? (
          <WidgetControls
            widgetName={chrome.widgetName}
            onRemove={chrome.onRemove}
            setActivatorNodeRef={chrome.setActivatorNodeRef}
            dragListeners={chrome.dragListeners}
            dragAttributes={chrome.dragAttributes}
          />
        ) : null}
      </div>
      <div
        className={wrapClick ? styles.widgetBodyClickable : styles.widgetBody}
        data-widget-zone="body"
        role={wrapClick ? 'button' : undefined}
        tabIndex={wrapClick ? 0 : undefined}
        onClick={wrapClick ? handleClick : undefined}
        onKeyDown={wrapClick ? handleKeyDown : undefined}
        aria-label={wrapClick ? `Open ${def.name} detail` : undefined}
      >
        {wrapClick && (
          <span className={styles.drillArrow} aria-hidden="true">
            ↗
          </span>
        )}
        <EmptyWidgetContext.Provider value={chainedSetEmpty}>{body}</EmptyWidgetContext.Provider>
      </div>
    </>
  );
}

export const WidgetRenderer = memo(WidgetRendererInner);
