import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties } from 'react';
import clsx from 'clsx';

import ProjectSquircle from '../../components/ProjectSquircle/ProjectSquircle.js';
import { projectGradient } from '../../lib/projectGradient.js';
import glass from '../../components/surface/glass.module.css';
import { computeConnectorPath } from './modelConnectorRouter.js';
import type {
  ModelInsight,
  ModelNarrativeSegment,
  ModelPresentation,
} from './modelPresentationTypes.js';
import { modelInsightById } from './modelPresentationTypes.js';
import styles from './ModelView.module.css';

const INSTALL_KEY = 'seorak-install';

/** One id, because one annotation is open at a time. */
const PEEK_ID = 'model-insight-peek';

const LANE_GAP = 40;
const LANE_MIN = 260;
const CARD_MAX_W = 340;
const CARD_PAD_RIGHT = 8;
const CARD_ANCHOR_Y = 26;
const DEFAULT_LINE_HEIGHT = 34;

/** Break the compiled segment stream into paragraphs at blank-line text nodes. */
function toParagraphs(segments: ModelNarrativeSegment[]): ModelNarrativeSegment[][] {
  const paragraphs: ModelNarrativeSegment[][] = [];
  let current: ModelNarrativeSegment[] = [];
  for (const segment of segments) {
    if (segment.type === 'text' && segment.text.includes('\n\n')) {
      const parts = segment.text.split(/\n\n+/);
      const head = parts.shift() ?? '';
      if (head) current.push({ type: 'text', text: head });
      if (current.length) paragraphs.push(current);
      current = [];
      const tail = parts.join('\n\n');
      if (tail) current.push({ type: 'text', text: tail });
      continue;
    }
    current.push(segment);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

type Geometry =
  | {
      mode: 'lane';
      connectorD: string;
      termX: number;
      termY: number;
      laneX: number;
      cardTop: number;
      cardW: number;
    }
  | { mode: 'below' };

/**
 * ModelNarrativeRead — the identity-led portrait read. At rest the prose is
 * calm: every insight carries a quiet underline, meaning "there's a hidden
 * annotation here" — the user never sees all annotations at once. Pull one
 * (hover to peek, click to pin) and it lifts to a highlight while its connector
 * routes through the line-gaps (never across characters) out to a cited card in
 * the margin lane. One annotation open at a time; falls back to an in-place card
 * when the lane is too narrow.
 */
export default function ModelNarrativeRead({
  presentation,
  ariaLabel = "Who you've been lately",
}: {
  presentation: ModelPresentation;
  ariaLabel?: string;
}) {
  const insightById = useMemo(() => modelInsightById(presentation), [presentation]);
  const paragraphs = useMemo(() => toParagraphs(presentation.prose), [presentation.prose]);
  const readRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const termEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [geom, setGeom] = useState<Geometry | null>(null);

  const shownId = activeId ?? hoverId;
  const shownInsight = shownId ? insightById[shownId] ?? null : null;
  const pinned = activeId != null;

  // Drop any open detail / peek when the portrait itself changes (scenario swap).
  useEffect(() => {
    setActiveId(null);
    setHoverId(null);
  }, [presentation]);

  // Dismissal for a PINNED annotation. There is deliberately no close button in
  // the card: it is an annotation on a sentence, not a dialog, and a "Done" chip
  // asked the reader to acknowledge a footnote. The three ways out are the three a
  // reader already expects — press Escape, click the underlined term again, or
  // click away — and Escape hands focus back to the term it came from, which is
  // the one job the button was actually doing.
  useEffect(() => {
    if (!activeId) return;

    const dismiss = () => {
      termEls.current.get(activeId)?.focus();
      setActiveId(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // A click on the card itself, or on ANY term, is not a dismissal: the card
      // is being read, and another term is a switch that `toggleActive` owns.
      if (detailRef.current?.contains(target)) return;
      for (const el of termEls.current.values()) {
        if (el.contains(target)) return;
      }
      setActiveId(null);
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [activeId]);

  const measure = useCallback((id: string): Geometry | null => {
    const container = readRef.current;
    const column = columnRef.current;
    const term = termEls.current.get(id);
    if (!container || !column || !term) return null;

    const c = container.getBoundingClientRect();
    const col = column.getBoundingClientRect();
    const t = term.getBoundingClientRect();

    const textLeft = col.left - c.left;
    const textRight = col.right - c.left;
    const laneX = textRight + LANE_GAP;
    const available = c.width - laneX - CARD_PAD_RIGHT;
    if (available < LANE_MIN) return { mode: 'below' };

    const proseEl = column.querySelector('p');
    const lhStr = proseEl ? window.getComputedStyle(proseEl).lineHeight : '';
    const lineHeight = lhStr.endsWith('px') ? parseFloat(lhStr) : DEFAULT_LINE_HEIGHT;

    const termX = t.right - c.left;
    const termY = t.top - c.top + t.height / 2;
    const cardTop = Math.max(0, termY - CARD_ANCHOR_Y);
    const badgeY = cardTop + CARD_ANCHOR_Y;

    return {
      mode: 'lane',
      connectorD: computeConnectorPath({
        termX,
        termY,
        badgeX: laneX,
        badgeY,
        textLeft,
        textRight,
        lineHeight,
        side: 'right',
      }),
      termX,
      termY,
      laneX,
      cardTop,
      cardW: Math.min(CARD_MAX_W, available),
    };
  }, []);

  useLayoutEffect(() => {
    if (!shownId) {
      setGeom(null);
      return;
    }
    const recompute = () => setGeom(measure(shownId));
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [shownId, measure, presentation]);

  const setTermRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) termEls.current.set(id, node);
    else termEls.current.delete(id);
  }, []);

  const toggleActive = useCallback((id: string) => {
    setHoverId(null);
    setActiveId((prev) => (prev === id ? null : id));
  }, []);

  const renderSegment = (segment: ModelNarrativeSegment, index: number) => {
    if (segment.type === 'text') {
      return <span key={`t-${index}`}>{segment.text}</span>;
    }

    if (segment.type === 'identityLead') {
      return (
        <span key={`lead-${index}`} className={styles.identityLead}>
          <ProjectSquircle projectKey={INSTALL_KEY} className={styles.identityAvatar} />
          <span>{segment.greeting}</span>
        </span>
      );
    }

    const insight = insightById[segment.insightId];
    if (!insight) return null;
    const isShown = shownId === insight.id;

    return (
      <button
        key={`insight-${insight.id}-${index}`}
        ref={(node) => setTermRef(insight.id, node)}
        type="button"
        data-annotation-term={insight.linkedTerm}
        data-facet={insight.facet}
        className={clsx(styles.term, styles[`termFacet_${insight.facet}`], isShown && styles.termShown)}
        onClick={() => toggleActive(insight.id)}
        onMouseEnter={() => !pinned && setHoverId(insight.id)}
        onMouseLeave={() => setHoverId((prev) => (prev === insight.id ? null : prev))}
        onFocus={() => !pinned && setHoverId(insight.id)}
        onBlur={() => setHoverId((prev) => (prev === insight.id ? null : prev))}
        // Not `aria-haspopup="dialog"`. It never opened a dialog — the card is a
        // `region` — and the "Done" button was the only thing that made that claim
        // look true. `aria-expanded` is the honest signal for a term that reveals
        // its own annotation.
        aria-expanded={isShown}
        // The PEEK is a `tooltip` and nothing pointed at it, so a reader tabbing
        // through the terms opened one and was never told what it said: focus
        // fires the same peek a hover does, and an unreferenced tooltip is not
        // announced. Only while peeking — once pinned the card is a `region` that
        // takes focus itself, and describing the term with it too would read the
        // whole card out twice.
        aria-describedby={isShown && !pinned ? PEEK_ID : undefined}
      >
        {insight.linkedTerm}
      </button>
    );
  };

  return (
    <div ref={readRef} className={styles.read} aria-label={ariaLabel}>
      <div ref={columnRef} className={styles.column}>
        <div className={styles.prose}>
          {paragraphs.map((group, groupIndex) => (
            <p key={groupIndex} className={styles.proseLine}>
              {group.map(renderSegment)}
            </p>
          ))}
        </div>

        {shownInsight && (!geom || geom.mode === 'below') && (
          <ModelInsightDetail
            ref={detailRef}
            insight={shownInsight}
            pinned={pinned}
            className={styles.detailBelow}
          />
        )}
      </div>

      {shownInsight && geom?.mode === 'lane' && (
        <>
          <svg className={styles.connectorSvg} aria-hidden="true" overflow="visible">
            <g className={styles[`termFacet_${shownInsight.facet}`]}>
              <path className={styles.connectorPath} d={geom.connectorD} />
              <circle className={styles.connectorDot} cx={geom.termX} cy={geom.termY} r={3} />
            </g>
          </svg>

          <ModelInsightDetail
            ref={detailRef}
            insight={shownInsight}
            pinned={pinned}
            className={styles.detailLane}
            style={{ left: geom.laneX, top: geom.cardTop, width: geom.cardW }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Cited detail for the pulled insight — soft environment, hard evidence.
 *
 * No close control. This is a margin note on a sentence, and a "Done" chip in its
 * corner made it look like a dialog the reader owed an answer to, on a page whose
 * whole point is a calm read. Dismissal lives with the parent: Escape, clicking
 * the term again, or clicking away — see the effect in `ModelNarrativeRead`.
 */
const ModelInsightDetail = forwardRef<
  HTMLDivElement,
  {
    insight: ModelInsight;
    pinned: boolean;
    className?: string;
    style?: CSSProperties;
  }
>(function ModelInsightDetail({ insight, pinned, className, style }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  const gradient = insight.squircle.projectKey
    ? projectGradient(insight.squircle.projectKey)
    : undefined;
  const share = insight.squircle.share;

  useEffect(() => {
    if (pinned) ref.current?.focus();
  }, [pinned, insight.id]);

  return (
    <div
      ref={(node) => {
        ref.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      id={pinned ? undefined : PEEK_ID}
      className={clsx(
        styles.detail,
        // The facet class is what hands the card its hue (--insight-accent); without
        // it the card was the one part of the annotation not wearing its category.
        styles[`termFacet_${insight.facet}`],
        glass.sheetNote,
        glass.rim,
        className,
        !pinned && styles.detailPeek,
      )}
      role={pinned ? 'region' : 'tooltip'}
      aria-label={insight.label}
      tabIndex={pinned ? -1 : undefined}
      style={style}
    >
      <div className={styles.detailHead}>
        {insight.squircle.projectKey ? (
          <ProjectSquircle
            projectKey={insight.squircle.projectKey}
            size="sm"
            className={styles.detailSwatch}
          />
        ) : (
          <span
            className={clsx(styles.detailSwatch, styles.detailSwatchFacet)}
            data-facet={insight.facet}
            aria-hidden="true"
          />
        )}
        <h2 className={styles.detailTitle}>{insight.label}</h2>
      </div>

      {/* Two tiers, which is what `hoverLines` was declared for and never got.
        * A PEEK is the gist — one or two lines, no numbers — so hovering along a
        * paragraph stays a skim. PINNING is where the receipts are: the counts,
        * the boundary they were counted against, and how they were derived. Both
        * tiers rendered the full card before, so `hoverLines` was dead on all
        * seventeen insights and a hover dumped a wall of citations at a reader
        * who had only brushed past a word. */}
      {!pinned && insight.hoverLines.length > 0 && (
        <ul className={styles.detailPeekLines}>
          {insight.hoverLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {pinned && insight.squircle.detail && (
        <p className={styles.detailBody}>{insight.squircle.detail}</p>
      )}

      {pinned && insight.squircle.citations.length > 0 && (
        <ul className={styles.detailCitations}>
          {insight.squircle.citations.map((citation) => (
            <li key={`${citation.field}-${citation.text}`}>{citation.text}</li>
          ))}
        </ul>
      )}

      {/* Filled to the share the card states, not full-width. aria-hidden because
        * the same number is spelled out in the line directly above it, so a
        * screen reader would otherwise hear it twice. */}
      {gradient && share !== undefined && (
        <div className={styles.detailGradientTrack} aria-hidden="true">
          <div
            className={styles.detailGradient}
            style={{ background: gradient, width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
});
