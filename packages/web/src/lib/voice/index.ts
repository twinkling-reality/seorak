/**
 * The detail-view answer voice — one warm, person-to-person voice every answer
 * composes from. Import everything an answer needs from here.
 *
 * Copy rules: docs/reference/voice-and-scope.md. The five answer-voice rules and
 * this module's architecture are not promoted into docs/ yet; `tone.ts` is the
 * nearest thing to a written statement of them.
 */
export * from './tone.js';
export * from './text.js';
export * from './time.js';
export * from './nodes.js';

// One import home for the shared number formatters answers already lean on.
export { fmtCount, formatCost, formatTokens } from '../../widgets/utils.js';

// The spelled-out model name for answer prose ("Claude Opus 4.8"). The compact
// `formatModel` is a dense-label formatter, not voice, so it stays in
// lib/modelMeta.
export { formatModelLong } from '../modelMeta.js';
