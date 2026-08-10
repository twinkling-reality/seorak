import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import clsx from 'clsx';

import { ToolInline } from '../../components/ToolIcon/ToolIcon.js';
import glass from '../../components/surface/glass.module.css';
import { getToolMeta } from '../../lib/toolMeta.js';
import { computeConnectorPath } from '../ModelView/modelConnectorRouter.js';

import {
  narrativeParagraphs,
  type AgentsNarrative,
  type AgentsNarrativeSegment,
  type AgentsNote,
} from './agentsVerdict.js';
import styles from './AgentsView.module.css';

const LANE_GAP = 40;
const LANE_MIN = 260;
const CARD_MAX_W = 340;
const CARD_PAD_RIGHT = 8;
const CARD_ANCHOR_Y = 26;
/** Where on the docked head the wire lands: beside its title, not on its corner. */
const HEAD_ANCHOR_Y = 22;
const DEFAULT_LINE_HEIGHT = 34;

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
  | { mode: 'docked'; connectorD: string; termX: number; termY: number }
  | { mode: 'below' }
  | { mode: 'none' };

/**
 * AgentsNarrativeRead — the verdict in Model's annotation language, and the wire
 * from a claim to the evidence for it.
 *
 * Every note term carries a quiet dotted underline at rest. HOVER one and it peeks:
 * a glass card floats out over the evidence panel, tied back by a connector that
 * routes through the line-gaps. CLICK one and it pins: the note stops floating and
 * DOCKS into the panel head beside it (owned by AgentsView), the panel turns to the
 * section it cites, and the rows it cites take the same highlight the term has. An
 * annotation that sat on top of its own evidence would be a poor instrument, so the
 * only thing that ever covers the table is a hover.
 *
 * The card falls back to an in-flow position under the prose when the lane is too
 * narrow to hold it, and the wire is simply not drawn when the head is stacked
 * below the prose rather than beside it: a connector that cut back through the
 * paragraph it came from would be drawing a relationship the layout does not have.
 */
export default function AgentsNarrativeRead({
  narrative,
  pinnedId,
  onPin,
  splitRef,
  headRef,
}: {
  narrative: AgentsNarrative;
  pinnedId: string | null;
  onPin: (noteId: string | null) => void;
  splitRef: RefObject<HTMLDivElement | null>;
  headRef: RefObject<HTMLDivElement | null>;
}) {
  const noteById = useMemo(
    () => Object.fromEntries(narrative.notes.map((n) => [n.id, n])),
    [narrative.notes],
  );
  const paragraphs = useMemo(() => narrativeParagraphs(narrative.segments), [narrative]);
  const readRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const termEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [geom, setGeom] = useState<Geometry | null>(null);

  const pinnedNote: AgentsNote | null = pinnedId ? noteById[pinnedId] ?? null : null;
  const pinned = pinnedNote != null;
  // While a note is pinned, hovering another term does nothing: the pinned note owns
  // the panel beside it, and a peek card over evidence for a DIFFERENT section would
  // be pointing at rows that are not there.
  const peekNote: AgentsNote | null = !pinned && hoverId ? noteById[hoverId] ?? null : null;
  const shown = pinnedNote ?? peekNote;
  const shownId = shown?.id ?? null;

  // Drop the peek when the narrative CONTENT changes (range swap). Keyed on content,
  // not object identity: the overview poll rebuilds an equal narrative every tick.
  // The PIN survives a range swap on purpose — the note and the table beside it both
  // refill with the new window, which is the same question asked of new data.
  const narrativeKey = useMemo(() => JSON.stringify(narrative.segments), [narrative]);
  useEffect(() => {
    setHoverId(null);
  }, [narrativeKey]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPin(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned, onPin]);

  const measure = useCallback(
    (id: string, isPinned: boolean): Geometry | null => {
      const container = readRef.current;
      const column = columnRef.current;
      const split = splitRef.current;
      const term = termEls.current.get(id);
      if (!container || !column || !split || !term) return null;

      const c = container.getBoundingClientRect();
      const col = column.getBoundingClientRect();
      const t = term.getBoundingClientRect();

      const textLeft = col.left - c.left;
      const textRight = col.right - c.left;
      const termX = t.right - c.left;
      const termY = t.top - c.top + t.height / 2;

      const proseEl = column.querySelector('p');
      const lhStr = proseEl ? window.getComputedStyle(proseEl).lineHeight : '';
      const lineHeight = lhStr.endsWith('px') ? parseFloat(lhStr) : DEFAULT_LINE_HEIGHT;

      if (isPinned) {
        const head = headRef.current;
        if (!head) return { mode: 'none' };
        const h = head.getBoundingClientRect();
        // Only wire it up when the head sits BESIDE the read. Stacked, it is below the
        // prose and the two are already in reading order.
        if (h.left < c.right) return { mode: 'none' };
        const badgeY = h.top - c.top + HEAD_ANCHOR_Y;
        return {
          mode: 'docked',
          connectorD: computeConnectorPath({
            termX,
            termY,
            badgeX: h.left - c.left,
            badgeY,
            textLeft,
            textRight,
            lineHeight,
            side: 'right',
          }),
          termX,
          termY,
        };
      }

      // The peek lane runs from the prose out to the far edge of the split, so the
      // card floats OVER the evidence rather than in the dead margin beside it.
      const laneX = textRight + LANE_GAP;
      const available =
        split.getBoundingClientRect().right - c.left - laneX - CARD_PAD_RIGHT;
      if (available < LANE_MIN) return { mode: 'below' };

      const cardTop = Math.max(0, termY - CARD_ANCHOR_Y);
      return {
        mode: 'lane',
        connectorD: computeConnectorPath({
          termX,
          termY,
          badgeX: laneX,
          badgeY: cardTop + CARD_ANCHOR_Y,
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
    },
    [splitRef, headRef],
  );

  useLayoutEffect(() => {
    if (!shownId) {
      setGeom(null);
      return;
    }
    const recompute = () => setGeom(measure(shownId, pinned));
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [shownId, pinned, measure, narrativeKey]);

  const setTermRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) termEls.current.set(id, node);
    else termEls.current.delete(id);
  }, []);

  const renderSegment = (
    segment: AgentsNarrativeSegment,
    index: number,
    seenAgents: Set<string>,
  ) => {
    if (segment.type === 'text') return <span key={`t-${index}`}>{segment.text}</span>;
    if (segment.type === 'agent') {
      // The brand mark anchors an agent's FIRST mention in a paragraph;
      // repeats read as plain prose so the read doesn't turn into an icon row.
      if (seenAgents.has(segment.agentId)) {
        return <span key={`a-${index}`}>{getToolMeta(segment.agentId).label}</span>;
      }
      seenAgents.add(segment.agentId);
      return <ToolInline key={`a-${index}`} tool={segment.agentId} />;
    }
    const note = noteById[segment.noteId];
    if (!note) return <span key={`n-${index}`}>{segment.term}</span>;
    const isShown = shownId === segment.noteId;
    return (
      <button
        key={`n-${index}`}
        ref={(node) => setTermRef(segment.noteId, node)}
        type="button"
        className={clsx(
          styles.term,
          styles[`termSection_${note.section}`],
          isShown && styles.termShown,
        )}
        onClick={() => {
          setHoverId(null);
          onPin(pinnedId === segment.noteId ? null : segment.noteId);
        }}
        onMouseEnter={() => !pinned && setHoverId(segment.noteId)}
        onMouseLeave={() => setHoverId((prev) => (prev === segment.noteId ? null : prev))}
        onFocus={() => !pinned && setHoverId(segment.noteId)}
        onBlur={() => setHoverId((prev) => (prev === segment.noteId ? null : prev))}
        aria-haspopup="dialog"
        aria-expanded={isShown}
      >
        {segment.term}
      </button>
    );
  };

  const wired = geom?.mode === 'lane' || geom?.mode === 'docked';

  return (
    <div ref={readRef} className={styles.read} aria-label="Verdict">
      <div ref={columnRef} className={styles.column}>
        {paragraphs.map((group, groupIndex) => {
          const seenAgents = new Set<string>();
          return (
            <p key={groupIndex} className={styles.verdictRead}>
              {group.map((segment, index) => renderSegment(segment, index, seenAgents))}
            </p>
          );
        })}

        {peekNote && (!geom || geom.mode === 'below') && (
          <AgentsNoteCard note={peekNote} className={styles.noteBelow} />
        )}
      </div>

      {shown && wired && geom && 'connectorD' in geom && (
        <svg className={styles.connectorSvg} aria-hidden="true" overflow="visible">
          <g className={styles[`termSection_${shown.section}`]}>
            <path className={styles.connectorPath} d={geom.connectorD} />
            <circle className={styles.connectorDot} cx={geom.termX} cy={geom.termY} r={3} />
          </g>
        </svg>
      )}

      {peekNote && geom?.mode === 'lane' && (
        <AgentsNoteCard
          note={peekNote}
          className={styles.noteLane}
          style={{ left: geom.laneX, top: geom.cardTop, width: geom.cardW }}
        />
      )}
    </div>
  );
}

/**
 * The peek: what a hovered term shows before you commit to it. Never interactive
 * (click pins, which docks the note into the panel head instead), so it stays a
 * tooltip and floats free of the pointer.
 *
 * It carries its citations even though the panel beside it may already hold the same
 * rows: at hover time the panel can still be showing a DIFFERENT section, and a card
 * that answered "what does this number rest on?" with nothing would be worse than a
 * repeat. The pinned note drops them, because pinning guarantees the rows are there.
 */
function AgentsNoteCard({
  note,
  className,
  style,
}: {
  note: AgentsNote;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={clsx(
        styles.note,
        styles.notePeek,
        styles[`termSection_${note.section}`],
        glass.sheetNote,
        glass.rim,
        className,
      )}
      role="tooltip"
      aria-label={note.label}
      style={style}
    >
      <div className={styles.noteHead}>
        <span className={styles.noteSwatch} data-section={note.section} aria-hidden="true" />
        <h2 className={styles.noteTitle}>{note.label}</h2>
      </div>

      <p className={styles.noteDetail}>{note.detail}</p>

      {note.citations.length > 0 && (
        <ul className={styles.noteCitations}>
          {note.citations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
