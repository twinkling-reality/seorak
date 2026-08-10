import type { ModelNarrativeSegment } from './modelPresentationTypes.js';

export const DEFAULT_DISPLAY_NAME = 'You';

export function hasPersonalDisplayName(displayName: string): boolean {
  const trimmed = displayName.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== DEFAULT_DISPLAY_NAME.toLowerCase();
}

/** Friendly inline opener after the install squircle — comma, no em dash. */
export function identityGreeting(displayName: string): string {
  if (hasPersonalDisplayName(displayName)) {
    return `${displayName.trim()}, `;
  }
  return 'Hey, ';
}

export function identityLeadSegment(displayName: string): ModelNarrativeSegment {
  return {
    type: 'identityLead',
    displayName: hasPersonalDisplayName(displayName) ? displayName.trim() : null,
    greeting: identityGreeting(displayName),
  };
}

/** Prepend inline squircle lead + friendly greeting; flow the next clause in lowercase. */
export function applyIdentityLead(
  prose: ModelNarrativeSegment[],
  displayName: string,
): ModelNarrativeSegment[] {
  if (prose.length === 0) return prose;

  const rest = prose.map((segment, index) => {
    if (index !== 0 || segment.type !== 'text' || segment.text.length === 0) return segment;
    return {
      type: 'text' as const,
      text: segment.text.charAt(0).toLowerCase() + segment.text.slice(1),
    };
  });

  return [identityLeadSegment(displayName), ...rest];
}
