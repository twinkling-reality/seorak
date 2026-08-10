// Outcomes-specific end-reason presentation.
import { REASON_META } from '../../../widgets/bodies/atoms/endReasonStack.js';

// Human label for a session-end reason (events.ts SessionEndEvent.reason).
export function endReasonLabel(reason: string): string {
  const meta = REASON_META[reason as keyof typeof REASON_META];
  if (!meta) return reason;
  // Sentence case for detail prose ("You closed it accounts for…").
  return meta.label.charAt(0).toUpperCase() + meta.label.slice(1);
}

// Tone token for a reason — delegates to the shared REASON_META palette.
export function endReasonColor(reason: string): string {
  const meta = REASON_META[reason as keyof typeof REASON_META];
  return meta?.color ?? 'var(--viz-cat-other)';
}
