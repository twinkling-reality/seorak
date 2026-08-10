/**
 * project-glance.ts — the CATALOG of per-project stats: which metrics exist, what each
 * one is called, what it means, and how fresh its reading is. Pure metadata (id, label,
 * what, tier), publish-safe and data-access-free exactly like `SIGNAL_CATALOG`; the
 * "how to read the value" lives on the surface that renders it (the mobile resolver),
 * because reading a snapshot is surface-specific.
 *
 * THERE IS NO SELECTION ANY MORE, AND THAT IS THE POINT. This used to be a fifth
 * settings family beside `capture`, `notifications`, `liveActivity` and `projectThemes`,
 * storing WHICH of these metrics a project drew, because the mobile surface rendered
 * them as a grid of tiles and seventeen tiles was nine screens of texture. The grid is
 * gone: a project's stats are a list of rows now, one line each, so a metric costs a row
 * instead of a screen and there is nothing left to choose BETWEEN. Every measured metric
 * is listed, in this file's order.
 *
 * That removal is also the answer to a question this product had already decided
 * elsewhere. The composable tile boards came off the phone because asking the owner to
 * assemble a screen out of numbers is curation, and the settled answer to "which numbers
 * do you want" is *almost none, and never by hand*. The picker was the last piece of
 * that question still standing, and it was mobile-only, so the two surfaces disagreed
 * about whether a project's stats are chosen at all.
 *
 * ORDER HERE IS THE ORDER ON SCREEN, and it groups by `tier`: what is running right now,
 * then what the window measured, then what matured after the work landed. A fixed order
 * also makes the column of figures comparable BETWEEN projects, which a per-repo
 * selection quietly made impossible.
 *
 * v1 catalog = the ZERO-NEW-AGGREGATION set (ADR-4): live per-session metrics (the
 * live board filtered by repoId), the per-repo window rollups that already exist
 * (ProjectRollup / RepoMomentum / RepoTemperature), and the per-repo outcome fate
 * (OverviewSnapshot.outcomes.bySession filtered by repoId). Global-only metrics
 * (per-repo error rate, ship/one-shot rate, cache reuse, peak hour, cost delta) are
 * deliberately ABSENT until the phase-2b per-repo rollup lands — promising them now
 * would mean a faked per-repo number or a dead control.
 */

/** Where a glance metric's value comes from, and how fresh it is:
 *  - `live`    — a property of a RUNNING session in this repo (the live board filtered
 *                by repoId); honest-empty when nothing is running.
 *  - `window`  — a per-repo rollup over the dashboard window (ProjectRollup /
 *                RepoMomentum / RepoTemperature).
 *  - `outcome` — a retrospective per-repo fate (lineSurvival via bySession); matures
 *                a few days after a session lands commits. */
export type GlanceTier = "live" | "window" | "outcome";

/** The v1 metric ids. Each is serveable with NO new worker aggregation (ADR-4). */
export const GLANCE_METRIC_IDS = [
  // live (per running session in this repo)
  "running_now",
  "live_session",
  "live_cost",
  // window (per-repo rollups)
  "sessions",
  "cost",
  "tokens",
  "tool_calls",
  "net_lines",
  "files_touched",
  "commits",
  "temperature",
  "error_rate",
  "cache_reuse",
  "cost_trend",
  // outcome (per-repo)
  "line_survival",
  "ship_rate",
  "one_shot",
] as const;

export type GlanceMetricId = (typeof GLANCE_METRIC_IDS)[number];

/** Catalog metadata for one glance metric — pure data, no data access (the surface
 *  resolver reads the actual value). `label` is the card label; `what` is the
 *  one-line picker explainer; `tier` drives the freshness/grouping copy. */
export interface GlanceMetricMeta {
  id: GlanceMetricId;
  label: string;
  what: string;
  tier: GlanceTier;
}

/** The catalog. Order is the ORDER ON SCREEN (live, then window, then outcome), and it
 *  is the same on every project, so a figure can be compared between them. Adding a
 *  metric is a types edit + a resolver case, never a UI edit. */
export const GLANCE_CATALOG: Record<GlanceMetricId, GlanceMetricMeta> = {
  running_now: {
    id: "running_now",
    label: "Running now",
    what: "How many sessions are live in this project right now.",
    tier: "live",
  },
  live_session: {
    id: "live_session",
    label: "Active session",
    what: "How long the current session has been running.",
    tier: "live",
  },
  live_cost: {
    id: "live_cost",
    label: "Live cost",
    what: "Estimated spend on the current session so far, from token counts at list prices.",
    tier: "live",
  },
  sessions: {
    id: "sessions",
    label: "Sessions",
    what: "Sessions in this project over the window.",
    tier: "window",
  },
  cost: {
    id: "cost",
    label: "Cost",
    what: "Estimated spend in this project over the window, from token counts at list prices.",
    tier: "window",
  },
  tokens: {
    id: "tokens",
    label: "Tokens",
    what: "Tokens used in this project over the window.",
    tier: "window",
  },
  tool_calls: {
    id: "tool_calls",
    label: "Tool calls",
    what: "Tool calls in this project over the window.",
    tier: "window",
  },
  net_lines: {
    id: "net_lines",
    label: "Net lines",
    what: "Git lines added minus removed (generated/lockfile excluded).",
    tier: "window",
  },
  files_touched: {
    id: "files_touched",
    label: "Files touched",
    what: "Distinct non-ignored files changed in the git window.",
    tier: "window",
  },
  commits: {
    id: "commits",
    label: "Commits",
    what: "Commits in the git window.",
    tier: "window",
  },
  temperature: {
    id: "temperature",
    label: "Temperature",
    what: "Heating / steady / cooling / quiet vs this repo's own baseline.",
    tier: "window",
  },
  error_rate: {
    id: "error_rate",
    label: "Error rate",
    what: "Share of this project's tool calls that failed over the window.",
    tier: "window",
  },
  cache_reuse: {
    id: "cache_reuse",
    label: "Cache reuse",
    what: "Cached vs fresh input tokens in this project (context reuse).",
    tier: "window",
  },
  cost_trend: {
    id: "cost_trend",
    label: "Cost trend",
    what: "This project's spend this window, with the change vs the prior window.",
    tier: "window",
  },
  line_survival: {
    id: "line_survival",
    label: "Lines held",
    what: "Of matured sessions, how many had their lines retained on-branch.",
    tier: "outcome",
  },
  ship_rate: {
    id: "ship_rate",
    label: "Shipped",
    what: "Share of this project's sessions that landed a commit.",
    tier: "outcome",
  },
  one_shot: {
    id: "one_shot",
    label: "One-shot",
    what: "Share of ended sessions that ran without a retry loop.",
    tier: "outcome",
  },
};

export function isGlanceMetricId(id: unknown): id is GlanceMetricId {
  return typeof id === "string" && id in GLANCE_CATALOG;
}
