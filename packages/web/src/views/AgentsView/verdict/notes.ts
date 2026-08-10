/**
 * The annotated-prose format the verdict is compiled into, and nothing that decides
 * what it says.
 *
 * It is a contract between three parties that must not drift: the sentence builders
 * (narrative, models, outcomes) emit it, AgentsNarrativeRead renders it, and
 * AgentsView docks the pinned note beside the section it names. Keeping the shape
 * here means a builder cannot invent a fourth segment kind the reader cannot draw.
 */

/** Section anchor a note's evidence lives under (matches section element ids). */
export type AgentsNoteSection = 'outcomes' | 'matrix' | 'where' | 'when' | 'models' | 'coverage';

export interface AgentsNote {
  id: string;
  section: AgentsNoteSection;
  /** Card header. */
  label: string;
  /** One person-talking line of context for the citations. */
  detail: string;
  /** Hard evidence lines, cited from the tables below the verdict. */
  citations: string[];
  /**
   * Row ids in this note's own section table that already carry its numbers. When
   * set, the panel marks those rows and drops the citation lines: the row states
   * the fact, and restating it in prose a few pixels above is one fact wearing two
   * hats. Left unset where the section has no row to point at (When is a chart,
   * Where is keyed by repo rather than by metric), and there the citations stand
   * on their own.
   */
  cites?: string[];
}

export type AgentsNarrativeSegment =
  | { type: 'text'; text: string }
  | { type: 'agent'; agentId: string }
  | { type: 'note'; noteId: string; term: string };

export interface AgentsNarrative {
  segments: AgentsNarrativeSegment[];
  notes: AgentsNote[];
  /** Agent id that led, or null when neither dominated / no data. */
  leaderId: string | null;
}

export function t(text: string): AgentsNarrativeSegment {
  return { type: 'text', text };
}

export function mark(agentId: string): AgentsNarrativeSegment {
  return { type: 'agent', agentId };
}

export function note(noteId: string, term: string): AgentsNarrativeSegment {
  return { type: 'note', noteId, term };
}

/**
 * Break the segment stream into paragraphs at blank-line text nodes (the same
 * contract Model's read uses). A text segment containing "\n\n" ends the
 * current paragraph; the remainder starts the next.
 */
export function narrativeParagraphs(
  segments: AgentsNarrativeSegment[],
): AgentsNarrativeSegment[][] {
  const paragraphs: AgentsNarrativeSegment[][] = [];
  let current: AgentsNarrativeSegment[] = [];
  for (const segment of segments) {
    if (segment.type === 'text' && segment.text.includes('\n\n')) {
      const parts = segment.text.split(/\n\n+/);
      const head = parts.shift() ?? '';
      if (head) current.push(t(head));
      if (current.length) paragraphs.push(current);
      current = [];
      const tail = parts.join('\n\n');
      if (tail) current.push(t(tail));
      continue;
    }
    current.push(segment);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}
