import clsx from 'clsx';
import { useDraggable } from '@dnd-kit/core';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';

import { isPickerAddBlocked } from '../../lib/widgetReadiness.js';
import type { WidgetDef } from '../catalog/index.js';
import styles from '../WidgetCatalog.module.css';

import { catalogDraggableId, catalogRowDragData, catalogRowDraggable } from './catalogDrag.js';
import { availabilityLabel, readinessBadge } from './catalogMeta.js';

export function CatalogRow({
  widget,
  active,
  onToggle,
  onHover,
  onHoverEnd,
  onOpenDetail,
  overview,
  capture,
}: {
  widget: WidgetDef;
  active: boolean;
  onToggle: () => void;
  onHover: (el: HTMLElement) => void;
  onHoverEnd: () => void;
  /** Present when the widget declares a drillTarget: closes the picker and
   *  opens the widget's detail surface. Works for rows not on the dashboard
   *  too — the drills read the same snapshot regardless of board membership,
   *  so previewing a detail before adding the widget is a supported path. */
  onOpenDetail?: () => void;
  overview?: OverviewSnapshot | null;
  capture?: CaptureSettings | null;
}) {
  const blocked = isPickerAddBlocked(widget.id, capture);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: catalogDraggableId(widget.id),
    data: catalogRowDragData(widget),
    disabled: active || blocked,
  });
  const canDrag = catalogRowDraggable(active, blocked);
  const availBadge = availabilityLabel(widget);
  const readyBadge = readinessBadge(widget, overview, capture);
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        styles.panelRow,
        canDrag && styles.panelRowDraggable,
        isDragging && styles.panelRowDragging,
        blocked && styles.panelRowBlocked,
      )}
      // Names the row for behaviour tests without depending on hashed CSS
      // module class names. Presentation-neutral.
      data-widget-row={widget.id}
      onClick={blocked ? undefined : onToggle}
      onMouseEnter={(e) => onHover(e.currentTarget)}
      onMouseLeave={onHoverEnd}
      // Keyboard parity for the hover preview: focus entering the row (its
      // toggle or detail button — React onFocus bubbles) shows the same
      // tooltip hover shows. No new tab stops.
      onFocus={(e) => onHover(e.currentTarget)}
      onBlur={onHoverEnd}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
    >
      <div className={styles.panelRowInfo}>
        <div className={styles.panelRowHead}>
          <div className={styles.panelRowName}>{widget.name}</div>
          {availBadge && <span className={styles.availabilityBadge}>{availBadge}</span>}
          {!availBadge && readyBadge && (
            <span className={clsx(styles.availabilityBadge, styles.readinessBadge)}>{readyBadge}</span>
          )}
        </div>
        <div className={styles.panelRowDesc}>{widget.description}</div>
      </div>
      {onOpenDetail && (
        <button
          type="button"
          className={styles.rowDrill}
          aria-label={`Open ${widget.name} detail`}
          title={`Open ${widget.name} detail`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          // Keep Enter/Space activation from leaking into the row's dnd-kit
          // keyboard-drag listeners.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
        >
          ↗
        </button>
      )}
      <button
        type="button"
        className={clsx(styles.toggle, active && styles.toggleOn)}
        aria-label={active ? `Remove ${widget.name}` : `Add ${widget.name}`}
        disabled={blocked && !active}
        onClick={(e) => {
          e.stopPropagation();
          if (blocked && !active) return;
          onToggle();
        }}
      />
    </div>
  );
}
