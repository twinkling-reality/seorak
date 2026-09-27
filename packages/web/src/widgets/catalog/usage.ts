import type { WidgetDef } from './types.js';

// Usage widgets — KPI stats that quantify volume, plus the cross-project
// comparator. All are live: `sessions`, `cost`, `cache-reuse`, and `cost-per-edit`
// from KV/token capture; `edits` from the per-tool call log; and the git COUNTS
// (`commits`/`files-touched`/`lines-added`/`lines-removed`/`net-lines`) from
// git.momentum + commitStats (anti-vanity: counts only, never paths/diffs; the
// honest lead is net change + breadth, never raw lines-added).
export const USAGE_WIDGETS: WidgetDef[] = [
  {
    id: 'momentum',
    name: 'repo activity',
    description:
      "Repos with recent commits, files touched, and net line change against each repo's prior git window. Quiet repos stay visible.",
    category: 'usage',
    scope: 'overview',
    viz: 'data-list',
    // 12-wide rowSpan-4: the cross-repo HERO. fitContent compresses it for a
    // one-repo user; the breadth head + per-repo table fill it otherwise.
    w: 12,
    h: 4,
    minW: 6,
    minH: 3,
    maxH: 5,
    fitContent: true,
    dataKeys: ['dashboard'],
    // Rows own their clicks (each drills to that repo's project view, plus a
    // per-row View pill); the drillTarget serves the empty-state wrapper and
    // the SectionOverflow tail.
    drillTarget: { view: 'usage', tab: 'projects' },
    ownsClick: true,
    requiresCapture: 'commitTracking',
  },
  {
    id: 'sessions',
    name: 'sessions',
    description:
      'How many sessions your agent ran this period. A session that ran no tool and spent nothing is not counted, so this stays the denominator for the numbers beside it. Use it with cost and how sessions ended, not as a score.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
    drillTarget: { view: 'usage', tab: 'sessions' },
    ownsClick: true,
  },
  {
    id: 'edits',
    name: 'edit calls',
    description:
      'Edit, Write, MultiEdit, and NotebookEdit calls this period. Counts tool calls, not changed lines.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'usage', tab: 'edits' },
    ownsClick: true,
  },
  {
    id: 'lines-added',
    name: 'lines added',
    description:
      'Lines added in the current git window. Generated and lockfile lines are excluded.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    // DA-13 (resolved): a git line COUNT must NOT drill to the Usage → Lines
    // panel — that measures edit-tool VOLUME (reverts included), a different,
    // larger magnitude for the same word. Its honest same-basis home is
    // Codebase → Git, which sums the SAME git.momentum snapshot (overview.ts
    // commitStats), so the number holds across the drill. Reconcile, don't hide.
    dataKeys: ['dashboard'],
    drillTarget: { view: 'codebase', tab: 'git', q: 'git-ground-truth' },
    ownsClick: true,
  },
  {
    id: 'lines-removed',
    name: 'lines removed',
    description:
      'Lines removed in the current git window. Generated and lockfile lines are excluded.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    // DA-13 (resolved): git line COUNT, drills to Codebase → Git (see lines-added).
    dataKeys: ['dashboard'],
    drillTarget: { view: 'codebase', tab: 'git', q: 'git-ground-truth' },
    ownsClick: true,
  },
  {
    id: 'files-touched',
    name: 'files touched',
    description:
      'Distinct files changed in the current git window. Counts only. Paths stay on your machine.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    // Git ground-truth count; drills to the same-basis Codebase → Git panel.
    dataKeys: ['dashboard'],
    drillTarget: { view: 'codebase', tab: 'git', q: 'git-ground-truth' },
    ownsClick: true,
  },
  {
    id: 'commits',
    name: 'commits',
    description:
      'Commits landed in the current git window. Counts only. SHAs and messages stay on your machine.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['commit_stats'],
    drillTarget: { view: 'codebase', tab: 'git', q: 'git-ground-truth' },
    ownsClick: true,
    requiresCapture: 'commitTracking',
  },
  {
    id: 'net-lines',
    name: 'net lines',
    description:
      'Lines added minus lines removed in the current git window. Generated and lockfile lines are excluded.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['commit_stats'],
    drillTarget: { view: 'codebase', tab: 'git', q: 'git-ground-truth' },
    ownsClick: true,
    requiresCapture: 'commitTracking',
  },
  {
    id: 'cost',
    name: 'cost',
    description:
      'Estimated token spend for this period. Click in for spend by day and by model.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
    drillTarget: { view: 'usage', tab: 'cost', q: 'spend' },
    ownsClick: true,
    requiresCapture: 'tokenUsage',
  },
  {
    id: 'cache-reuse',
    name: 'context reuse',
    description:
      'Share of context served from cache instead of sent again. Lower reuse can mean higher token cost.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
    drillTarget: { view: 'usage', tab: 'cost', q: 'context-reuse' },
    requiresCapture: 'tokenUsage',
  },
  {
    id: 'cost-per-edit',
    name: 'cost per edit',
    description:
      'Average token spend per edit-tool call this period. Fills in after Seorak has cost and edit-call data.',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
    drillTarget: { view: 'usage', tab: 'cost', q: 'spend' },
    requiresCapture: 'tokenUsage',
    availability: 'available',
  },
  {
    id: 'trend',
    name: 'sessions per day',
    description: 'Daily session cadence across the selected period.',
    category: 'usage',
    scope: 'both',
    viz: 'sparkline',
    // Half-width sparkline: a recognizable weekly cadence without dominating the
    // cockpit. fitContent compresses it to its locked empty state until the
    // daily series lands.
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    fitContent: true,
    dataKeys: ['daily_trends'],
    drillTarget: { view: 'usage', tab: 'sessions', q: 'volume' },
  },
  {
    id: 'projects',
    name: 'projects',
    description:
      'Rank your repos on sessions, active sessions, and recency. Side-by-side A/B compare: docs/specs/multi-repo.md.',
    category: 'usage',
    scope: 'overview',
    viz: 'project-list',
    // 6-col default: project rows are a compact leaderboard, not a
    // hero-width surface. Paired repo compare: docs/specs/multi-repo.md.
    w: 6,
    h: 3,
    minW: 6,
    minH: 2,
    // Same opt-in as the live session board: WidgetGrid's useFitRowSpan measures
    // the table's scrollHeight and shrinks the cell's grid-row span to the
    // minimum needed (clamped at h:3 as ceiling). A single-project user
    // sees a 1-row tall cell instead of 3 rows of empty space; a
    // many-project user gets the full 3 rows + scroll inside the body.
    fitContent: true,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'usage', tab: 'projects', q: 'overview' },
    ownsClick: true,
  },
];
