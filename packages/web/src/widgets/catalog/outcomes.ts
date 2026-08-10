import type { WidgetDef } from './types.js';

// Outcomes widgets — how sessions ended and its derivatives (one-shot rate,
// stuckness, ship rate, line survival). The session-end-reasons strip is the
// point-in-time view; outcome-trend is the SAME lifecycle reasons over a per-day
// series, now fed from the retained event log (FOLLOW-UP #5). `line-survival` is
// the honest, revert-catching durability read: a later re-check of the lines
// themselves, so a revert reads as changed back. Per-session line-survival rows
// stay in the data contract for the detail view, not as a default dashboard tile.
// All honest-empty until ends/checks accrue.
export const OUTCOMES_WIDGETS: WidgetDef[] = [
  {
    id: 'ship-rate',
    name: 'ship rate',
    description:
      'Share of finished sessions where a commit landed. A shipping read, not a judgment.',
    category: 'outcomes',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'shipped' },
    ownsClick: true,
    requiresCapture: 'commitTracking',
  },
  {
    id: 'line-survival',
    name: 'line survival',
    description:
      'Share of agent-authored lines still present on your branch a few days later. Reverts count as changed back. A low rate means more changed back, never bad work.',
    category: 'outcomes',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'line-survival' },
    ownsClick: true,
    requiresCapture: 'commitTracking',
  },
  {
    id: 'session-end-reasons',
    name: 'how sessions ended',
    description:
      'Where your Claude Code sessions stopped: you closed them, continued from saved, signed out, left at the input, and more.',
    category: 'outcomes',
    // Per-repo: the worker projects endReasons onto each ProjectRollup and
    // scopeToProject maps it in, so this renders THIS repo under a repo header (DA-06 real fix).
    scope: 'both',
    viz: 'proportional-bar',
    w: 12,
    h: 3,
    minW: 8,
    minH: 3,
    maxH: 3,
    fitContent: true,
    dataKeys: ['dashboard'],
    // Wrapper-owned drill, like every other ShareFace / proportional-bar widget
    // (tool-mix, verification, directories): the strip's segments are inert, so
    // the standard container affordance (hover + corner arrow) carries the drill.
    // NOT ownsClick — an ownsClick body must wire its own click when populated,
    // and this ShareFaceFrame has none, which made the tile a dead click once it
    // had data (audit A1).
    drillTarget: { view: 'outcomes', tab: 'sessions' },
  },
  {
    id: 'outcome-trend',
    name: 'how sessions ended, over time',
    description:
      'How sessions stopped day by day: closed, continued from saved, signed out, left at the input, and more across the selected period.',
    category: 'outcomes',
    scope: 'both',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'ended-by-day' },
  },
  {
    id: 'one-shot-rate',
    name: 'one-shot rate',
    description:
      'Share of sessions that ran without a retry loop. A cadence read, not a success score.',
    category: 'outcomes',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['tool_call_stats'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'one-shot' },
    requiresCapture: 'toolCallLogs',
  },
  {
    id: 'stuckness',
    name: 'stuck rate',
    description:
      'Share of live sessions quiet long enough to flag for attention.',
    category: 'outcomes',
    scope: 'both',
    // viz: 'stat' so the hero value uses --display-hero like one-shot-rate,
    // edits, cost, cost-per-edit — every KPI-shape widget in the system
    // renders at the same typography tier. The ratio + recovered% live in
    // the CoverageNote caption slot so they're visible without stealing
    // the hero tier.
    viz: 'stat',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['stuckness'],
    drillTarget: { view: 'outcomes', tab: 'sessions', q: 'stuck' },
    ownsClick: true,
  },
];
