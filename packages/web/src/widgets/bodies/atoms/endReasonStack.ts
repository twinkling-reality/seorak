import type { StackedAreaEntry } from '../../../components/viz/time/StackedArea.js';

/**
 * endReasonStack — shared mapping from per-bucket session-end reason counts to
 * StackedArea bands, used by BOTH outcome-trend (per day) and hourly-effectiveness
 * (per hour). LIFECYCLE reasons (how sessions ended), never a completion grade.
 */

export type EndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other';

export interface ReasonMeta {
  /** Strip legend — what happened, in terms you would recognize. */
  label: string;
  /** Head caption when this reason is top: renders as "sessions {caption}". */
  caption: string;
  color: string;
  /** Hover — plain explanation, no hook/enum jargon. */
  hint: string;
}

/** Claude Code SessionEnd reasons → what actually happened to you. */
export const REASON_META: Record<EndReason, ReasonMeta> = {
  clear: {
    label: 'you closed it',
    caption: 'you closed',
    color: 'var(--success)',
    hint: 'You finished or cleared the chat and the session ended. No error, no interrupt.',
  },
  resume: {
    label: 'continued from saved',
    caption: 'continued from saved',
    color: 'var(--viz-seq-1)',
    hint: 'You left this session to pick up an older one (Claude Code resume).',
  },
  logout: {
    label: 'signed out',
    caption: 'after sign-out',
    color: 'var(--viz-seq-5)',
    hint: 'You signed out of Claude Code and the session ended.',
  },
  prompt_input_exit: {
    label: 'left at the input',
    caption: 'left at the input',
    color: 'var(--viz-seq-4)',
    hint: 'You quit or switched away while Claude was waiting for your reply.',
  },
  bypass_permissions_disabled: {
    label: 'auto-approve off',
    caption: 'when auto-approve turned off',
    color: 'var(--warn)',
    hint: 'Claude stopped auto-approving tool runs partway through the session.',
  },
  other: {
    label: 'unknown',
    caption: 'with unknown end',
    color: 'var(--viz-cat-other)',
    hint: 'The session ended but no reason was recorded.',
  },
};

const REASON_ORDER: EndReason[] = [
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'bypass_permissions_disabled',
  'other',
];

interface ReasonCount {
  reason: string;
  count: number;
}

export function reasonMeta(reason: string): ReasonMeta {
  return REASON_META[reason as EndReason] ?? REASON_META.other;
}

/**
 * Build StackedArea entries from per-bucket end-reason counts. `axis` is the
 * StackedAreaPoint.day field — an ISO date for the day series, a clock-hour label
 * (e.g. "15:00") for the hour series. Returns one band per reason present, dense
 * across all buckets.
 */
export function endReasonStackEntries(
  buckets: ReadonlyArray<{ axis: string; reasons: ReadonlyArray<ReasonCount> }>,
): StackedAreaEntry[] {
  const axes = buckets.map((b) => b.axis);
  const present = new Set<string>();
  for (const b of buckets) {
    for (const r of b.reasons) if (r.count > 0) present.add(r.reason);
  }
  const reasons = [
    ...REASON_ORDER.filter((r) => present.has(r)),
    ...[...present].filter((r) => !REASON_ORDER.includes(r as EndReason)),
  ];
  return reasons.map((reason) => {
    const meta = reasonMeta(reason);
    const byAxis = new Map<string, number>();
    for (const b of buckets) {
      byAxis.set(b.axis, b.reasons.find((x) => x.reason === reason)?.count ?? 0);
    }
    return {
      key: reason,
      label: meta.label,
      color: meta.color,
      series: axes.map((axis) => ({ day: axis, value: byAxis.get(axis) ?? 0 })),
    };
  });
}

/** Total ended sessions across all buckets — the honest-empty gate (0 → render an
 *  empty state, never an empty chart). */
export function totalEnded(
  buckets: ReadonlyArray<{ reasons: ReadonlyArray<ReasonCount> }>,
): number {
  let total = 0;
  for (const b of buckets) for (const r of b.reasons) total += r.count;
  return total;
}
