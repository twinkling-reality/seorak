import type { WidgetDef } from './types.js';

// Activity widgets — the temporal lens: when work happens (heatmap, from
// session.start in the event log) and how sessions END by clock hour
// (hourly-effectiveness, now fed from the worker's per-hour session-end reason
// series — FOLLOW-UP #5). A cadence lens, never a completion grade. Both
// honest-empty until the event log holds the rows.
export const ACTIVITY_WIDGETS: WidgetDef[] = [
  {
    id: 'heatmap',
    name: 'activity heatmap',
    description: 'When you run agent sessions, by hour and day of week.',
    category: 'activity',
    // Per-repo: the worker projects hourlyDistribution onto each ProjectRollup
    // and scopeToProject maps it in, so this renders THIS repo (DA-06 real fix).
    scope: 'both',
    viz: 'heatmap',
    w: 12,
    h: 3,
    minW: 8,
    minH: 3,
    dataKeys: ['hourly_distribution'],
    drillTarget: { view: 'activity', tab: 'rhythm', q: 'when' },
  },
  {
    id: 'hourly-effectiveness',
    name: 'how sessions ended, by hour',
    description:
      'How sessions ended by clock hour. Helps spot when runs tend to wrap up. Fills in as sessions end.',
    category: 'activity',
    // Per-repo: the worker projects endReasonsByHour onto each ProjectRollup and
    // scopeToProject maps it in, so this renders THIS repo (DA-06 real fix).
    scope: 'both',
    viz: 'sparkline',
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxH: 3,
    fitContent: true,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'ended-by-day' },
  },
];
