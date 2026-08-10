/**
 * The Agents verdict's public surface. Everything AgentsView, the read, and the
 * history chart are allowed to reach for; the panels themselves live in `verdict/`,
 * one module per thing that can be independently wrong:
 *
 *   verdict/metrics.ts    edit volume, error coverage, and the column ORDER every
 *                         panel shares — change it and all four tables move together
 *   verdict/cells.ts      the honest-empty cell vocabulary the tables render through
 *   verdict/record.ts     what Seorak has a record OF, as opposed to what happened
 *   verdict/clock.ts      the viewer's local hours, shared by the chart and the prose
 *   verdict/notes.ts      the annotated-prose format, and nothing that decides content
 *   verdict/matrix.ts     the Why table and its error-row disclosures
 *   verdict/where.ts      the per-repo split
 *   verdict/coverage.ts   the capability ledger behind every empty cell
 *   verdict/history.ts    the chart-ready day and hour spine
 *   verdict/models.ts     the models sentence, whose unit changes with the data
 *   verdict/outcomes.ts   the survival floor and coverage gate, table AND prose
 *   verdict/narrative.ts  the volume read and the fit paragraph
 *
 * This is a surface, not a compatibility shim: there is no second path to these
 * symbols, and nothing here is deprecated.
 */

export { agentEditVolume, rankAgents } from './verdict/metrics.js';
export type { MatrixCell, MatrixRow } from './verdict/cells.js';
export { agentRecordStarts, recordRailWorthShowing } from './verdict/record.js';
export { agentCadences, localHourOf } from './verdict/clock.js';
export { narrativeParagraphs } from './verdict/notes.js';
export type {
  AgentsNarrative,
  AgentsNarrativeSegment,
  AgentsNote,
  AgentsNoteSection,
} from './verdict/notes.js';
export { buildAgentsMatrix } from './verdict/matrix.js';
export type { AgentsMatrix } from './verdict/matrix.js';
export { buildAgentsWhere } from './verdict/where.js';
export type { WhereProjectRow } from './verdict/where.js';
export { buildAgentsCoverage } from './verdict/coverage.js';
export type { CoverageCell, CoverageRow, CoverageTone } from './verdict/coverage.js';
export { buildAgentsHistory } from './verdict/history.js';
export type { AgentsHistorySeries } from './verdict/history.js';
export { majorityModelByAgent } from './verdict/models.js';
export { agentTraceShare, buildAgentsOutcomes, shownSurvivalRate } from './verdict/outcomes.js';
export type { AgentsOutcomes } from './verdict/outcomes.js';
export { buildAgentsNarrative } from './verdict/narrative.js';
