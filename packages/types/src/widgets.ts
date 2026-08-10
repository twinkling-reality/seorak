/**
 * widgets.ts — the shared stat catalog metadata.
 *
 * The web dashboard and grounded stat chat must agree on which stats exist and
 * what they're called. The web keeps its rich React `WidgetDef` (viz, grid spans,
 * drill targets, React bodies) in `packages/web`; the stable `id`, human `name`,
 * `category`, and `dataKeys` live here in a publish-safe module.
 *
 * This is metadata only: no React and no presentation logic. The web's
 * `WidgetDef` is asserted to be a strict superset by a convergence test in
 * `packages/web`, so ids, names, categories, and data keys cannot drift.
 */

export type SignalCategory =
  | "live"
  | "usage"
  | "outcomes"
  | "activity"
  | "codebase"
  | "tools";

export interface WidgetSignalMeta {
  /** Stable id shared by the web catalog and grounded stat citations. */
  id: string;
  /** Human label, identical to the web catalog's `name`. */
  name: string;
  category: SignalCategory;
  /** Data sources the signal reads (drives availability); mirrors the web `dataKeys`. */
  dataKeys: string[];
}

/**
 * SEORAK_SIGNALS — the canonical cross-surface catalog. Every web `WIDGET_CATALOG`
 * entry MUST appear here with a matching id/name/category/dataKeys (asserted by
 * the web convergence test).
 */
export const SEORAK_SIGNALS: WidgetSignalMeta[] = [
  // ── live ──────────────────────────────────────────────────────────────
  { id: "live-sessions", name: "live sessions", category: "live", dataKeys: ["dashboard"] },
  { id: "files-in-play", name: "files in play", category: "live", dataKeys: ["dashboard"] },

  // ── usage ─────────────────────────────────────────────────────────────
  { id: "momentum", name: "repo activity", category: "usage", dataKeys: ["dashboard"] },
  { id: "sessions", name: "sessions", category: "usage", dataKeys: ["daily_trends"] },
  { id: "edits", name: "edit calls", category: "usage", dataKeys: ["dashboard"] },
  { id: "lines-added", name: "lines added", category: "usage", dataKeys: ["dashboard"] },
  { id: "lines-removed", name: "lines removed", category: "usage", dataKeys: ["dashboard"] },
  { id: "files-touched", name: "files touched", category: "usage", dataKeys: ["dashboard"] },
  { id: "commits", name: "commits", category: "usage", dataKeys: ["commit_stats"] },
  { id: "net-lines", name: "net lines", category: "usage", dataKeys: ["commit_stats"] },
  { id: "cost", name: "cost", category: "usage", dataKeys: ["token_usage"] },
  { id: "cache-reuse", name: "context reuse", category: "usage", dataKeys: ["token_usage"] },
  { id: "cost-per-edit", name: "cost per edit", category: "usage", dataKeys: ["token_usage"] },
  { id: "trend", name: "sessions per day", category: "usage", dataKeys: ["daily_trends"] },
  { id: "projects", name: "projects", category: "usage", dataKeys: ["dashboard"] },

  // ── outcomes ──────────────────────────────────────────────────────────
  { id: "ship-rate", name: "ship rate", category: "outcomes", dataKeys: ["dashboard"] },
  { id: "line-survival", name: "line survival", category: "outcomes", dataKeys: ["dashboard"] },
  { id: "session-end-reasons", name: "how sessions ended", category: "outcomes", dataKeys: ["dashboard"] },
  { id: "outcome-trend", name: "how sessions ended, over time", category: "outcomes", dataKeys: ["dashboard"] },
  { id: "one-shot-rate", name: "one-shot rate", category: "outcomes", dataKeys: ["tool_call_stats"] },
  { id: "stuckness", name: "stuck rate", category: "outcomes", dataKeys: ["stuckness"] },

  // ── activity ──────────────────────────────────────────────────────────
  { id: "heatmap", name: "activity heatmap", category: "activity", dataKeys: ["hourly_distribution"] },
  { id: "hourly-effectiveness", name: "how sessions ended, by hour", category: "activity", dataKeys: ["dashboard"] },

  // ── codebase ──────────────────────────────────────────────────────────
  { id: "directories", name: "top directories", category: "codebase", dataKeys: ["directory_heatmap"] },
  { id: "files", name: "top files", category: "codebase", dataKeys: ["file_heatmap"] },
  { id: "file-rework", name: "files edited repeatedly", category: "codebase", dataKeys: ["file_rework"] },

  // ── tools ─────────────────────────────────────────────────────────────
  { id: "tool-mix", name: "tool mix", category: "tools", dataKeys: ["dashboard"] },
  { id: "model-mix", name: "model mix", category: "tools", dataKeys: ["model_outcomes", "token_usage"] },
  {
    id: "agent-edit-share",
    name: "agent edit share",
    category: "tools",
    dataKeys: ["dashboard"],
  },
  { id: "tool-call-errors", name: "tool call error rate", category: "tools", dataKeys: ["tool_call_stats"] },
  { id: "verification", name: "verification checks", category: "tools", dataKeys: ["tool_call_stats"] },
];

const SIGNAL_MAP = new Map(SEORAK_SIGNALS.map((s) => [s.id, s]));

export function getSignal(id: string): WidgetSignalMeta | undefined {
  return SIGNAL_MAP.get(id);
}
