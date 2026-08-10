import clsx from 'clsx';
import type { CSSProperties, RefObject } from 'react';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';

import glass from '../../components/surface/glass.module.css';
import type { WidgetDef } from '../catalog/index.js';
import styles from '../WidgetCatalog.module.css';

import {
  availabilityLabel,
  dataKeyLabel,
  readinessBadge,
  sizeLabel,
  timeScopeNote,
  VIZ_LABELS,
} from './catalogMeta.js';
import { WidgetPreview } from './WidgetPreview.js';

/** The floating card beside a hovered row: the widget's name, its live specimen,
 *  and the bare facts as a caption. Inert and aria-hidden — the row it describes
 *  is the thing a reader tabs to. */
export function CatalogTooltip({
  widget,
  onBoard,
  overview,
  capture,
  style,
  visible,
  tooltipRef,
}: {
  widget: WidgetDef;
  onBoard: boolean;
  overview?: OverviewSnapshot | null;
  capture?: CaptureSettings | null;
  style: CSSProperties;
  visible: boolean;
  tooltipRef: RefObject<HTMLDivElement | null>;
}) {
  const availability = availabilityLabel(widget);
  const readiness = readinessBadge(widget, overview, capture);
  const data = dataKeyLabel(widget);
  const scopeNote = timeScopeNote(widget);
  return (
    <div
      ref={tooltipRef}
      className={clsx(
        styles.tooltip,
        glass.sheetStrong,
        glass.rim,
        visible && styles.tooltipVisible,
      )}
      style={style}
      aria-hidden="true"
    >
      {/* Head: the name anchors the floating card to its row; state and
        * honesty badges ride the same line. No description — the hovered
        * row already says it, a gap-width away. The Added pill renders
        * only for the on-board state (the picker's Show filter vocabulary);
        * a permanent not-added chip would restate the row's own toggle. */}
      <div className={styles.tooltipHead}>
        <span className={styles.tooltipName}>{widget.name}</span>
        {availability && <span className={styles.availabilityBadge}>{availability}</span>}
        {!availability && readiness && (
          <span className={clsx(styles.availabilityBadge, styles.readinessBadge)}>
            {readiness}
          </span>
        )}
        {onBoard && <span className={clsx(styles.statusPill, glass.rim)}>Added</span>}
      </div>
      <WidgetPreview widget={widget} overview={overview} capture={capture} />
      {/* Caption line: bare inline label-value pairs under the specimen.
        * The preview is the card's only framed object — the facts whisper
        * as a caption, flowing horizontally so a short value never strands
        * a ragged empty column and a third fact never orphans a grid row.
        * Data is skipped for the generic 'dashboard' key. */}
      <div className={styles.specStrip}>
        <span className={styles.specPair}>
          <span className={styles.specLabel}>Type</span>
          <span className={styles.specValue}>{VIZ_LABELS[widget.viz]}</span>
        </span>
        <span className={styles.specPair}>
          <span className={styles.specLabel}>Size</span>
          <span className={styles.specValue}>{sizeLabel(widget.w)}</span>
        </span>
        {data && (
          <span className={styles.specPair}>
            <span className={styles.specLabel}>Data</span>
            <span className={styles.specValue}>{data}</span>
          </span>
        )}
      </div>
      {scopeNote && <p className={styles.tooltipScope}>{scopeNote}</p>}
    </div>
  );
}
