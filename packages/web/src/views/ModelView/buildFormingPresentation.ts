import type { ModelInsight, ModelNarrativeSegment } from './modelPresentationTypes.js';
import { FACET_USER_LABELS } from './computePortraitForming.js';
import type { PortraitFormingState } from './modelPresentationTypes.js';
import { applyIdentityLead } from './modelIdentityLead.js';

/**
 * Clamped, because the forming read is chosen by INSIGHT count and never by
 * session count: a window with more than three sessions that still produces no
 * insight (a repo-scoped read where focus is silent by design and the hours are
 * too spread for either rhythm clause) rendered "7 of 3 sessions logged in this
 * window".
 */
function sessionLine(forming: PortraitFormingState): string {
  const counted = Math.min(forming.sessionCount, forming.sessionsRequired);
  return `${counted} of ${forming.sessionsRequired} sessions logged in this window`;
}

function formingInsights(forming: PortraitFormingState): ModelInsight[] {
  const sessions = sessionLine(forming);

  return [
    {
      id: 'forming-evenings',
      facet: 'rhythm',
      linkedTerm: 'evening developer',
      label: FACET_USER_LABELS.rhythm,
      hoverLines: ['Session start times across the month', sessions],
      squircle: {
        detail: 'When you run agent sessions, cadence only, not an effectiveness grade.',
        citations: [{ text: 'Waiting on session starts', field: 'activity.hourlyDistribution' }],
      },
    },
    {
      id: 'forming-main-repo',
      facet: 'focus',
      linkedTerm: 'your main repo',
      label: FACET_USER_LABELS.focus,
      hoverLines: ['Which repos got your sessions', sessions],
      squircle: {
        detail: 'Where attention went this period.',
        citations: [{ text: 'Waiting to see which projects you work in', field: 'focus.projectFocus' }],
      },
    },
    {
      id: 'forming-typescript',
      facet: 'stack',
      linkedTerm: 'TypeScript',
      label: FACET_USER_LABELS.stack,
      hoverLines: ['Languages and file kinds from edits', sessions],
      squircle: {
        detail: 'Language mix from edit calls.',
        citations: [{ text: 'Waiting to see which languages you edit', field: 'identity.fileLanguageMix' }],
      },
    },
    {
      id: 'forming-close-chat',
      facet: 'shape',
      linkedTerm: 'close the chat',
      label: FACET_USER_LABELS.shape,
      hoverLines: ['How sessions end and branch habits', sessions],
      squircle: {
        detail: 'How finished sessions stopped in this period.',
        citations: [{ text: 'Waiting on end reasons', field: 'outcomes.endReasons' }],
      },
    },
    {
      id: 'forming-stick',
      facet: 'payoff',
      // Was the bare verb 'stick'. The prose drops the five linked terms into a
      // comma list, so the ONLY sentence a user with no data ever sees ended
      // "..., close the chat, and stick." — not English, and unrecoverable. A noun
      // phrase matching the shipped survival term ('stayed in the codebase') makes
      // every item in the list the same shape.
      linkedTerm: 'whether it stayed',
      label: FACET_USER_LABELS.payoff,
      hoverLines: ['Whether the lines you land stay in the codebase', sessions],
      squircle: {
        // Not the hover line again. The ghost cards have no counts to show, so the
        // one line they DO get has to say something the peek did not — here, when
        // the check runs, which is the part of this measurement a reader is most
        // surprised by.
        detail: 'A check runs days after the work lands and looks for your lines on the branch.',
        citations: [
          { text: 'Waiting to see whether your work stays in the codebase', field: 'outcomes.lineSurvival.rate' },
        ],
      },
    },
  ];
}

function formingProse(): ModelNarrativeSegment[] {
  return [
    { type: 'text', text: 'Run your first agent sessions and this read starts filling in: ' },
    { type: 'insight', insightId: 'forming-evenings' },
    { type: 'text', text: ', ' },
    { type: 'insight', insightId: 'forming-main-repo' },
    { type: 'text', text: ', ' },
    { type: 'insight', insightId: 'forming-typescript' },
    { type: 'text', text: ', ' },
    { type: 'insight', insightId: 'forming-close-chat' },
    { type: 'text', text: ', and ' },
    { type: 'insight', insightId: 'forming-stick' },
    { type: 'text', text: '.' },
  ];
}

export function buildFormingPresentation(
  forming: PortraitFormingState,
  displayName: string,
): {
  prose: ModelNarrativeSegment[];
  insights: ModelInsight[];
} {
  return {
    prose: applyIdentityLead(formingProse(), displayName),
    insights: formingInsights(forming),
  };
}
