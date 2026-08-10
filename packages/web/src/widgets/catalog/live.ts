import type { WidgetDef } from './types.js';

// Live widgets — real-time snapshots that bypass the global date picker.
// The team-coordination entries (live-conflicts, claimed-files) are stripped
// for the solo model; live-sessions is the hero session board (rebuilt against
// SessionSummary), and files-in-play is a ranked list of the files current
// sessions are editing, from the salted fileId signal (ids + counts only,
// paths never leave the machine).
export const LIVE_WIDGETS: WidgetDef[] = [
  {
    id: 'live-sessions',
    name: 'live sessions',
    description: 'Your sessions running right now, with project, tool, status, and elapsed time.',
    category: 'live',
    scope: 'both',
    viz: 'live-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
    drillTarget: { view: 'live', tab: 'sessions', q: 'active-sessions' },
    ownsClick: true,
  },
  {
    id: 'files-in-play',
    // Renamed from "live file targets": "targets" read as goals (or worse,
    // pager vocabulary) and said nothing about editing. Plain words win the
    // stranger test; the live chrome already says "right now".
    name: 'files in play',
    description:
      'Files in play across your running sessions, ranked by activity. Counts only. Paths stay on your machine.',
    category: 'live',
    scope: 'both',
    // The Share face: a live attention strip (segment = file, width = share
    // of edits by current sessions, color = project). Same canonical form as
    // tool-mix, so the NOW band pairs a table (who) with a strip (where).
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
    // Whole-tile drill into the live Files tab (the full in-play list). No
    // ownsClick: the strip's segments are inert, so the standard container
    // affordance (hover + corner arrow) carries the drill.
    drillTarget: { view: 'live', tab: 'files', q: 'files-in-play' },
    availability: 'available',
  },
];
