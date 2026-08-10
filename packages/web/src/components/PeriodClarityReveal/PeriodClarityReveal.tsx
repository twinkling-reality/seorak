import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import type { PeriodClarity, SummaryFacet, SummaryNote } from '../../periodClarity/compilePeriodClarity.js';
import glass from '../surface/glass.module.css';
import glassTrigger from '../controls/glassTrigger.module.css';
import ProjectSquircle from '../ProjectSquircle/ProjectSquircle.js';
import palette from '../../styles/narrativePalette.module.css';
import { computeConnectorPath } from '../../views/ModelView/modelConnectorRouter.js';
import styles from './PeriodClarityReveal.module.css';

const LANE_GAP = 40;
const LANE_MIN = 260;
const CARD_MAX_W = 340;
const CARD_PAD_RIGHT = 16;
const CARD_ANCHOR_Y = 26;
const DEFAULT_LINE_HEIGHT = 34;

const FACET_CLASS: Record<SummaryFacet, string> = {
  live: styles.facetLive,
  volume: styles.facetVolume,
  cost: styles.facetCost,
  outcome: styles.facetOutcome,
  caveat: styles.facetCaveat,
};

type Phase = 'open' | 'closing';

/** Viewport-fixed lane geometry — never parented inside the scrolling read. */
type Geometry = {
  connectorD: string;
  termX: number;
  termY: number;
  laneX: number;
  cardTop: number;
  cardW: number;
};

function geomEq(a: Geometry | null, b: Geometry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.connectorD === b.connectorD &&
    a.termX === b.termX &&
    a.termY === b.termY &&
    a.laneX === b.laneX &&
    a.cardTop === b.cardTop &&
    a.cardW === b.cardW
  );
}

/**
 * Summary chip → bottom fade. Annotation language matches Model / Agents:
 * hover peeks a lane card with connector; click pins. Lane chrome is
 * position:fixed so peeks can't expand the scrollport and stutter the overlay.
 */
export function PeriodClarityReveal({
  clarity,
  open,
  onOpenChange,
  showTrigger = true,
}: {
  clarity: PeriodClarity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showTrigger?: boolean;
}): ReactNode {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const termEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const rafRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [geom, setGeom] = useState<Geometry | null>(null);
  const [edgeFade, setEdgeFade] = useState<'none' | 'top' | 'bottom' | 'both'>('none');

  const noteById = useMemo(() => {
    const map: Record<string, SummaryNote> = {};
    for (const n of clarity.notes) map[n.id] = n;
    return map;
  }, [clarity.notes]);

  const pinned = activeId != null;
  const shownId = activeId ?? hoverId;
  const shownNote = shownId ? noteById[shownId] ?? null : null;

  useEffect(() => {
    if (open) {
      setPhase('open');
      setActiveId(null);
      setHoverId(null);
      setGeom(null);
      return;
    }
    setPhase((prev) => (prev === 'open' ? 'closing' : prev));
  }, [open]);

  const finishClose = useCallback(() => {
    setPhase((prev) => (prev !== 'closing' ? prev : null));
    setActiveId(null);
    setHoverId(null);
    setGeom(null);
  }, []);

  const requestClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (phase !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeId) {
          setActiveId(null);
          return;
        }
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, activeId, requestClose]);

  useEffect(() => {
    if (phase !== 'closing') return;
    const t = window.setTimeout(finishClose, 280);
    return () => window.clearTimeout(t);
  }, [phase, finishClose]);

  const measure = useCallback((id: string): Geometry | null => {
    const column = columnRef.current;
    const term = termEls.current.get(id);
    if (!column || !term) return null;

    const col = column.getBoundingClientRect();
    const t = term.getBoundingClientRect();

    // Viewport space — card/svg are position:fixed, not inside the scroller.
    const textLeft = col.left;
    const textRight = col.right;
    const laneX = textRight + LANE_GAP;
    const available = window.innerWidth - laneX - CARD_PAD_RIGHT;
    if (available < LANE_MIN) return null;

    const proseEl = term.closest('p') ?? column.querySelector('p');
    const lhStr = proseEl ? window.getComputedStyle(proseEl).lineHeight : '';
    const lineHeight = lhStr.endsWith('px') ? parseFloat(lhStr) : DEFAULT_LINE_HEIGHT;

    const termX = t.right;
    const termY = t.top + t.height / 2;
    const cardTop = Math.max(12, termY - CARD_ANCHOR_Y - lineHeight * 0.35);
    const badgeY = cardTop + CARD_ANCHOR_Y;

    return {
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

  const commitGeom = useCallback(
    (id: string) => {
      const next = measure(id);
      setGeom((prev) => (geomEq(prev, next) ? prev : next));
    },
    [measure],
  );

  useLayoutEffect(() => {
    if (!shownId || phase !== 'open') {
      setGeom(null);
      return;
    }

    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        commitGeom(shownId);
      });
    };

    commitGeom(shownId);
    const el = readRef.current;
    window.addEventListener('resize', schedule);
    el?.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('resize', schedule);
      el?.removeEventListener('scroll', schedule);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [shownId, commitGeom, phase, clarity]);

  const updateEdgeFade = useCallback(() => {
    const el = readRef.current;
    if (!el) return;
    const canUp = el.scrollTop > 1;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const next = canUp && canDown ? 'both' : canUp ? 'top' : canDown ? 'bottom' : 'none';
    setEdgeFade((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (phase !== 'open') {
      setEdgeFade('none');
      return;
    }
    updateEdgeFade();
    const el = readRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateEdgeFade());
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, clarity, updateEdgeFade]);

  const setTermRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) termEls.current.set(id, node);
    else termEls.current.delete(id);
  }, []);

  const toggleActive = useCallback((id: string) => {
    setHoverId(null);
    setActiveId((prev) => (prev === id ? null : id));
  }, []);

  const mounted = phase !== null;

  return (
    <div className={styles.root}>
      {showTrigger && (
        <button
          type="button"
          className={clsx(
            glassTrigger.glassTrigger,
            glass.sheet,
            glass.rim,
            open && glassTrigger.glassTriggerActive,
          )}
          aria-expanded={open}
          aria-controls={mounted ? titleId : undefined}
          aria-label="Summary of the selected range"
          onClick={() => onOpenChange(!open)}
        >
          Summary
        </button>
      )}

      {mounted
        ? createPortal(
            <div
              className={clsx(styles.layer, palette.narrativeHues)}
              data-phase={phase}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <button
                type="button"
                className={styles.scrim}
                aria-label="Dismiss summary"
                onClick={requestClose}
              />
              <div className={styles.fade} aria-hidden="true" />
              <div
                ref={readRef}
                className={clsx(
                  styles.read,
                  edgeFade === 'top' && styles.readFadeTop,
                  edgeFade === 'bottom' && styles.readFadeBottom,
                  edgeFade === 'both' && styles.readFadeBoth,
                )}
                onScroll={updateEdgeFade}
                onAnimationEnd={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (phase === 'closing') finishClose();
                }}
              >
                <div className={styles.readChrome}>
                  <h2 id={titleId} className={styles.eyebrow}>
                    Summary
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    className={styles.close}
                    onClick={requestClose}
                  >
                    Close
                  </button>
                </div>

                <div ref={columnRef} className={styles.column}>
                  <div className={styles.prose}>
                    {clarity.paragraphs.map((para, pi) => (
                      <p
                        key={pi}
                        className={para.role === 'lead' ? styles.lead : styles.line}
                      >
                        {para.segments.map((seg, si) => {
                          if (seg.type === 'text') {
                            return <span key={si}>{seg.text}</span>;
                          }
                          const note = noteById[seg.noteId];
                          if (!note) return <span key={si}>{seg.term}</span>;
                          const isShown = shownId === note.id;
                          return (
                            <button
                              key={si}
                              ref={(node) => setTermRef(note.id, node)}
                              type="button"
                              className={clsx(
                                styles.term,
                                FACET_CLASS[note.facet],
                                isShown && styles.termShown,
                              )}
                              data-facet={note.facet}
                              aria-expanded={isShown}
                              aria-haspopup="dialog"
                              onClick={() => toggleActive(note.id)}
                              onMouseEnter={() => !pinned && setHoverId(note.id)}
                              onMouseLeave={() =>
                                setHoverId((prev) => (prev === note.id ? null : prev))
                              }
                              onFocus={() => !pinned && setHoverId(note.id)}
                              onBlur={() =>
                                setHoverId((prev) => (prev === note.id ? null : prev))
                              }
                            >
                              {seg.term}
                            </button>
                          );
                        })}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {shownNote && geom ? (
                <>
                  <svg
                    className={styles.connectorFixed}
                    aria-hidden="true"
                    overflow="visible"
                  >
                    <g className={FACET_CLASS[shownNote.facet]}>
                      <path className={styles.connectorPath} d={geom.connectorD} />
                      <circle
                        className={styles.connectorDot}
                        cx={geom.termX}
                        cy={geom.termY}
                        r={3}
                      />
                    </g>
                  </svg>
                  <SummaryDetail
                    note={shownNote}
                    pinned={pinned}
                    onClose={() => setActiveId(null)}
                    className={styles.detailFixed}
                    style={{
                      left: geom.laneX,
                      top: geom.cardTop,
                      width: geom.cardW,
                    }}
                  />
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SummaryDetail({
  note,
  pinned,
  onClose,
  className,
  style,
}: {
  note: SummaryNote;
  pinned: boolean;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}): ReactNode {
  return (
    <div
      className={clsx(
        styles.detail,
        FACET_CLASS[note.facet],
        glass.rim,
        className,
        !pinned && styles.detailPeek,
      )}
      role={pinned ? 'region' : 'tooltip'}
      aria-label={note.label}
      style={style}
    >
      <div className={styles.detailHead}>
        {note.projectKey ? (
          <ProjectSquircle projectKey={note.projectKey} size="sm" className={styles.detailSwatch} />
        ) : (
          <span
            className={clsx(styles.detailSwatch, styles.detailSwatchFacet)}
            data-facet={note.facet}
            aria-hidden="true"
          />
        )}
        <h3 className={styles.detailTitle}>{note.label}</h3>
        {pinned ? (
          <button type="button" className={styles.detailClose} onClick={onClose}>
            Done
          </button>
        ) : null}
      </div>
      <p className={styles.detailBody}>{note.detail}</p>
      {note.citations.length > 0 ? (
        <ul className={styles.detailCitations}>
          {note.citations.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
