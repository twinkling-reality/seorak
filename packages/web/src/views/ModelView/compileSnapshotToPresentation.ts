import type { DeveloperModelSnapshot } from '@seorak/types';

import type { ModelNarrativeSegment, ModelPresentation } from './modelPresentationTypes.js';
import { buildFormingPresentation } from './buildFormingPresentation.js';
import {
  computePortraitFormingState,
  portraitIsThin,
} from './computePortraitForming.js';
import { applyIdentityLead } from './modelIdentityLead.js';
import { assemblePortrait } from './portrait/assemble.js';
import { buildPortraitContext } from './portrait/context.js';

export interface CompilePresentationOptions {
  displayName: string;
  /**
   * The reader's clock, `Date.getTimezoneOffset()` convention. Injected so the
   * portrait is reproducible: every claim about when the developer works is a
   * shift off the worker's UTC buckets, and a compiler that read the ambient
   * timezone itself would give a different portrait on every machine and could
   * not be tested at all.
   */
  offsetMinutes?: number;
  /**
   * The reader's offset in the middle of the PRIOR window, same convention.
   *
   * Only the shift sentence reads it, and only to decline: when the two windows
   * sat under different offsets, a prior-window hour bucket cannot be localized
   * correctly from the current offset, so "you were a morning developer" would be
   * a claim about a clock change rather than about the reader.
   *
   * Derived from the same source as `offsetMinutes`. Injecting `offsetMinutes` is
   * injecting a fixed clock, and a fixed clock has no transitions, so this then
   * defaults to it; pass it explicitly to pin the transition case.
   */
  priorOffsetMinutes?: number;
}

const DAY_MS = 86_400_000;

/** The ambient zone's offset in the middle of the prior adjacent window. */
function ambientPriorOffset(snapshot: DeveloperModelSnapshot): number {
  const generated = Date.parse(snapshot.scope.generatedAt);
  if (!Number.isFinite(generated)) return new Date().getTimezoneOffset();
  return new Date(generated - snapshot.scope.rangeDays * DAY_MS * 1.5).getTimezoneOffset();
}

function proseHasDigits(segments: ModelNarrativeSegment[]): boolean {
  return segments.some((s) => s.type === 'text' && /\d/.test(s.text));
}

/**
 * compileSnapshotToPresentation — snapshot in, portrait out.
 *
 * The read itself is assembled by the producers in `portrait/`, one per sentence.
 * What is left here is the frame around them: the reader's clock, the forming
 * fallback when the window is too thin to say anything, the identity lead, and
 * the labels. Adding a facet means adding a producer, not editing this file.
 */
export function compileSnapshotToPresentation(
  snapshot: DeveloperModelSnapshot,
  options: CompilePresentationOptions,
): ModelPresentation {
  const offsetMinutes = options.offsetMinutes ?? new Date().getTimezoneOffset();
  const ctx = buildPortraitContext(
    snapshot,
    offsetMinutes,
    options.priorOffsetMinutes ??
      (options.offsetMinutes === undefined ? ambientPriorOffset(snapshot) : offsetMinutes),
  );
  const { prose, insights } = assemblePortrait(snapshot, ctx);

  const forming = portraitIsThin(insights.length) ? computePortraitFormingState(snapshot) : null;
  const formingContent = forming ? buildFormingPresentation(forming, options.displayName) : null;
  const heroProse = formingContent?.prose ?? applyIdentityLead(prose, options.displayName);

  if (import.meta.env?.MODE !== 'production' && proseHasDigits(heroProse)) {
    console.warn('[seorak] Model compiler produced digits in hero prose: review templates');
  }

  return {
    displayName: options.displayName,
    prose: heroProse,
    insights: formingContent?.insights ?? insights,
    forming,
  };
}
