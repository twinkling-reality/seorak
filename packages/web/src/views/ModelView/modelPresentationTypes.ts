/**
 * Presentation contract for Model read view (web-owned, not in @seorak/types).
 * Compiler output: prose + color-coded insights for ModelView.
 */

export type ModelInsightFacet = 'rhythm' | 'focus' | 'stack' | 'shape' | 'payoff';
/** The annotation renderer is shared by Model and period Compare. Compare adds
 *  measured volume and cost without pretending either is a Model identity facet. */
export type NarrativeInsightFacet = ModelInsightFacet | 'volume' | 'cost';

export type ModelViewMode = 'read' | 'topic';

/**
 * What the forming read actually needs.
 *
 * This interface used to declare `leadLine`, `subLine`, `facets` (a
 * `FacetFormingProgress[]`), `previewTerms` and `sessionProgress` as well.
 * `computePortraitFormingState` returned `''`, `''`, `[]`, `[]` for the first
 * four and nothing anywhere read any of the five — the forming READ is prose plus
 * ghost cards built in `buildFormingPresentation`, and there is no progress bar
 * for a 0-to-1 fraction to drive. Five declared fields with no producer and no
 * consumer, on the first thing a new user sees. Deleted rather than filled: a
 * field that nothing renders is a promise the type keeps making and the UI never
 * honours (agent-standards §7).
 *
 * The two that remain are both live: they build the "N of 3 sessions logged in
 * this window" line on every forming card.
 */
export interface PortraitFormingState {
  sessionCount: number;
  sessionsRequired: number;
}

export interface ModelAnnotationCitation {
  text: string;
  /** Snapshot field path — dev contract only, not shown in UI */
  field: string;
}

export interface ModelInsight {
  id: string;
  facet: NarrativeInsightFacet;
  /** Must match narrative span text (case-insensitive lookup) */
  linkedTerm: string;
  /** Squircle header */
  label: string;
  /** 1–3 lines on hover / focus peek */
  hoverLines: string[];
  squircle: {
    detail?: string;
    citations: ModelAnnotationCitation[];
    /** focus facet only — drives projectAccent / projectGradient */
    projectKey?: string;
    /**
     * 0–1, the share this card's claim is about.
     *
     * Exists so the bar under a focus card can be FILLED to the number the card
     * states. It used to be a full-width gradient with nothing bound to it —
     * decoration that reads as a proportion bar on the one surface whose entire
     * job is letting a reader check a proportion. A chart that encodes nothing is
     * worse on an evidence card than no chart.
     */
    share?: number;
  };
}

export type ModelNarrativeSegment =
  | { type: 'text'; text: string }
  | { type: 'identityLead'; displayName: string | null; greeting: string }
  | { type: 'insight'; insightId: string };

/**
 * No `periodLabel` / `scopeLabel`. They existed for a footing under the read, and
 * on web the range pills and the project picker sit directly above it — a footing
 * was the same two facts printed twice, in a page whose whole job is a calm read.
 * The phone states its window in a footing because it has no range control; this
 * surface has both.
 */
export interface ModelPresentation {
  displayName: string;
  prose: ModelNarrativeSegment[];
  insights: ModelInsight[];
  /** Set when the portrait has no live insights yet — drives forming UI + progress. */
  forming: PortraitFormingState | null;
}

export function modelInsightById(p: ModelPresentation): Record<string, ModelInsight> {
  return Object.fromEntries(p.insights.map((insight) => [insight.id, insight]));
}
