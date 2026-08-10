import type { DeveloperModelSnapshot } from '@seorak/types';

import type { ModelInsightFacet, PortraitFormingState } from './modelPresentationTypes.js';

/** Sessions needed before cadence + shape insights can land in the portrait read. */
export const PORTRAIT_MIN_SESSIONS = 3;

export type { PortraitFormingState } from './modelPresentationTypes.js';

export const FACET_USER_LABELS: Record<ModelInsightFacet, string> = {
  rhythm: 'When you work',
  focus: 'Where attention went',
  stack: 'What you touched',
  shape: 'How you work',
  payoff: 'Whether it landed',
};

function sessionCountFromSnapshot(snapshot: DeveloperModelSnapshot): number {
  const fromFocus = snapshot.focus.projectFocus.reduce((sum, p) => sum + p.sessions, 0);
  if (fromFocus > 0) return fromFocus;
  return snapshot.activity.hourlyDistribution.reduce((sum, b) => sum + b.sessions, 0);
}

export function computePortraitFormingState(snapshot: DeveloperModelSnapshot): PortraitFormingState {
  return {
    sessionCount: sessionCountFromSnapshot(snapshot),
    sessionsRequired: PORTRAIT_MIN_SESSIONS,
  };
}

export function portraitIsThin(insightCount: number): boolean {
  return insightCount === 0;
}
