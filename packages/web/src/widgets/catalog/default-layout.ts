import type { WidgetSlot } from './types.js';

// Starter layout for week-one users. Leads with live presence + session/tool
// stats that accrue on the first sessions — not eight permanent `--` git/outcome
// tiles. Promotion to FULL_DEFAULT_LAYOUT happens when git or outcome stats
// mature (see `isReadyForFullLayout` in widgetReadiness.ts).
export const STARTER_DEFAULT_LAYOUT: WidgetSlot[] = [
  { id: 'live-sessions', colSpan: 12, rowSpan: 2 },
  { id: 'sessions', colSpan: 3, rowSpan: 2 },
  { id: 'cost', colSpan: 3, rowSpan: 2 },
  { id: 'edits', colSpan: 3, rowSpan: 2 },
  { id: 'one-shot-rate', colSpan: 3, rowSpan: 2 },
  { id: 'trend', colSpan: 6, rowSpan: 3 },
  { id: 'tool-mix', colSpan: 6, rowSpan: 3 },
];

export const STARTER_WIDGET_IDS = STARTER_DEFAULT_LAYOUT.map((s) => s.id);

// Full default layout for mature users (restore-default + auto-promotion).
// The cross-repo MOMENTUM board is the hero — the
// first thing a buyer sees is "what moved across everything this week", not
// session counting. The live-sessions board fills the NOW band at full width so
// presence reads as ambient state, not a half-card squeezed beside file targets.
// Outcome tiles (ship-rate "did it land?" + line-survival "did it LAST?") stay
// promoted so the cockpit leads with outcome + momentum, not pure volume
// (MODEL-REVIEW rec #12). All render the honest "--" on live data until git
// ground-truth accrues.
//
// line-survival is the honest, revert-catching durability HEADLINE (WS3 / OA1) —
// the ONE durability percentage on the board. Per-session line-survival rows stay
// in the outcomes detail, not on the default dashboard.
//
// Layout audit (2026-07-03): demote picker-only tiles that duplicate drill
// detail or need data the solo cockpit cannot headline yet — files-in-play
// (file targets belong in session drill), files-touched (net-lines + edits
// carry the git story), projects (per-repo leaderboard; paired compare is
// docs/specs/multi-repo.md, not default half-card), heatmap (rhythm is secondary until capture accrues). Promote
// stuckness into the git stat row so intervention signal sits beside landed
// work (commits, net-lines, edits). Pair trend + tool-mix at 6+6 — no orphan
// half-row for tool-mix alone.
//
// Kept out of the default: every team/memory/conversation/multi-tool tile that
// the solo model does not feed, plus the locked/per-tool drills that stay
// reachable via the picker but not the default cockpit.
//
// Widget bodies are registered separately from this layout; getWidget() returns
// undefined for an unregistered id and the grid skips it, so listing an id here
// is safe ahead of its catalog entry resolving.
// Width discipline (DASHBOARD-CLARITY): one width per role, and every band sums
// to a clean 12. Single-number stats are ALWAYS quarter-width (3); half-cards are
// 6; the momentum hero and live board are full-width (12). No lone 4s or 8s
// that leave the grid reading as arbitrary.
export const FULL_DEFAULT_LAYOUT: WidgetSlot[] = [
  // The cross-repo momentum board — the HERO. 12-wide; fitContent compresses it
  // for a one-repo user. Honest-empty until Seorak has seen a commit in a repo.
  { id: 'momentum', colSpan: 12, rowSpan: 4 },

  // The NOW band — live sessions as full-width presence rows. Ambient state, not
  // a half-card beside file targets (those stay in the session drill / picker).
  { id: 'live-sessions', colSpan: 12, rowSpan: 2 },

  // KPI row — four quarter-width stats: volume + the two git-ground-truth outcome
  // headlines (ship-rate "did it land?", line-survival "did it LAST?", the honest
  // revert-catching durability headline). Honest "--" until data accrues.
  { id: 'sessions', colSpan: 3, rowSpan: 2 },
  { id: 'cost', colSpan: 3, rowSpan: 2 },
  { id: 'ship-rate', colSpan: 3, rowSpan: 2 },
  { id: 'line-survival', colSpan: 3, rowSpan: 2 },

  // Git-ground-truth stat row — same quarter width as the KPI row so the two read
  // as one stat language: commits, net lines (added − removed, the anti-vanity
  // headline), edits (agent edit calls beside landed commits), plus stuckness
  // (intervention signal next to work landed). Honest "--" until data accrues.
  { id: 'commits', colSpan: 3, rowSpan: 2 },
  { id: 'net-lines', colSpan: 3, rowSpan: 2 },
  { id: 'edits', colSpan: 3, rowSpan: 2 },
  { id: 'stuckness', colSpan: 3, rowSpan: 2 },

  // Half-card bands, clean 6+6 pairs. Daily sessions trend beside tool split;
  // hot files + recurrence beside each other. All honest-empty until data accrues.
  // Half-card bands, clean 6+6 pairs. Daily sessions trend beside tool split;
  // agent edit share is a full-width fitContent band (collapses when single-
  // agent); hot files + recurrence beside each other.
  { id: 'trend', colSpan: 6, rowSpan: 3 },
  { id: 'tool-mix', colSpan: 6, rowSpan: 3 },

  { id: 'agent-edit-share', colSpan: 12, rowSpan: 3 },

  // Codebase pair — hot files + recurrence. Salted ids until the file-labels opt-in.
  { id: 'files', colSpan: 6, rowSpan: 3 },
  { id: 'file-rework', colSpan: 6, rowSpan: 3 },
];

/** Fresh installs start on the starter layout. */
export const DEFAULT_LAYOUT: WidgetSlot[] = STARTER_DEFAULT_LAYOUT;

export const DEFAULT_WIDGET_IDS = DEFAULT_LAYOUT.map((s) => s.id);
export const FULL_WIDGET_IDS = FULL_DEFAULT_LAYOUT.map((s) => s.id);
