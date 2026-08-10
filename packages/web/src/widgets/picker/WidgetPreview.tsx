// ── Live widget preview ───────────────────────────
//
// The tooltip's evidence area renders the REAL widget body — the same
// component the cockpit mounts — fed from the picker's own overview
// snapshot (already scoped per host view) and miniaturized with a CSS
// transform. Zero assets, zero fetching (bodies are pure), and the
// preview is structurally incapable of disagreeing with the board:
// honest-empty states render exactly as they would on the canvas.
// Falls back to the abstract VizIllustration when no body is registered
// or no snapshot has arrived yet.

import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';

import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import { widgetBodies } from '../bodies/registry.js';
import type { WidgetDef } from '../catalog/index.js';
import styles from '../WidgetCatalog.module.css';
import rendererStyles from '../WidgetRenderer.module.css';

import { previewLayout } from './previewLayout.js';
import { VizIllustration } from './VizIllustration.js';

/** The preview is inert — body-owned drills and project links can never
 *  fire from inside the tooltip. */
const previewOpenProject = () => {};

export function WidgetPreview({
  widget,
  overview,
  capture,
}: {
  widget: WidgetDef;
  overview?: OverviewSnapshot | null;
  capture?: CaptureSettings | null;
}) {
  const liveSessions = overview?.live ?? [];
  const Body = widgetBodies[widget.id];
  if (!Body || !overview) {
    return (
      <div className={styles.tooltipIllustration}>
        <VizIllustration viz={widget.viz} />
      </div>
    );
  }
  const { naturalW, naturalH, scale, frameHeight, clippedRight } = previewLayout(widget);
  return (
    <div className={styles.previewFrame} style={{ height: frameHeight }} inert>
      <div
        className={styles.previewCanvas}
        data-widget-viz={widget.viz}
        style={{ width: naturalW, height: naturalH, transform: `scale(${scale})` }}
      >
        {/* Full widget anatomy, not a disembodied body: the cockpit's title
         * anchors the top-left of every card, and without it a left-aligned
         * stat numeral floats in unowned space. Mirrors WidgetRenderer's
         * head + body structure minus the chrome controls. */}
        <div className={rendererStyles.widgetHead}>
          <SectionTitle>{widget.name}</SectionTitle>
        </div>
        <div className={rendererStyles.widgetBody}>
          <Body
            overview={overview}
            liveSessions={liveSessions}
            capture={capture ?? null}
            openProject={previewOpenProject}
          />
        </div>
      </div>
      {clippedRight && <div className={styles.previewFadeRight} />}
    </div>
  );
}
