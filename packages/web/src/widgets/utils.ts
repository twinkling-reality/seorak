// Widget-shared formatters and color helpers. Authored for Seorak's solo
// model: a single developer's sessions, no work-type taxonomy, no team
// analytics layer. Only the helpers the viz primitives and widget bodies
// actually use remain.

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Tool-call classification ──────────────────────
// Separates a host tool's built-in primitives from MCP / custom tools so a
// per-tool mix can lane them apart once the event log feeds tools.byTool.

const BUILTIN_TOOL_CALL_NAMES: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'BashOutput',
  'KillShell',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'SlashCommand',
  // Codex host built-ins (deliberately DISTINCT tokens — never merged with
  // Bash/Edit): the builtin lane means "the host tool's own primitives", which
  // these are; without them Codex's dominant tools would tint in the
  // custom/MCP lane color.
  'Shell',
  'ApplyPatch',
]);

export type ToolCallLane = 'builtin' | 'custom';

export function classifyToolCall(name: string): ToolCallLane {
  if (name.startsWith('mcp__')) return 'custom';
  if (BUILTIN_TOOL_CALL_NAMES.has(name)) return 'builtin';
  return 'custom';
}

// ── Formatters ────────────────────────────────────

export function fmtCount(n: number): string {
  return n.toLocaleString();
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * USD cost formatter. Returns the `--` sentinel for null/undefined so callers
 * can pass a nullable value without a ternary at every site. A measured but
 * sub-unit positive value renders "<$0.01" instead of "$0.00" (which reads like
 * a zero result when cost WAS measured); a genuine measured 0 still renders
 * "$0.00", and `--` stays null-only. Thousands separators keep large hero values
 * inside their slot.
 */
export function formatCost(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '--';
  const scale = 10 ** decimals;
  // DA-12: a measured positive value that rounds to zero at `decimals` would
  // print "$0.00" and read as a zero result. Show the smallest representable
  // amount ("<$0.01") so a real sub-cent cost is never confused with no cost.
  if (value > 0 && Math.round(value * scale) === 0) {
    const floor = (1 / scale).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `<${floor}`;
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Delta magnitude formatter for sub-cent USD movements. */
export function formatCostDelta(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.005) return `$${abs.toFixed(4)}`;
  return `$${abs.toFixed(3)}`;
}

/** Burn-rate formatter (USD per minute). */
export function formatRate(usdPerMin: number): string {
  if (usdPerMin >= 10) return `$${usdPerMin.toFixed(0)}/min`;
  return `$${usdPerMin.toFixed(2)}/min`;
}

/**
 * Honest-empty cost label for a LIVE session row. Two distinct "no dollars" cases,
 * two distinct treatments:
 *   - `costUsd == null`: the host tool CANNOT price its work (`cost:'none'`, an
 *     unpriced model). Unknown, never "$0.00". Reads "--".
 *   - `costUsd === 0` with no throughput yet: no cost basis yet (DA-02). Reads
 *     "--". This leg is what keeps a live Codex row honest: Codex CAN price
 *     (`cost:'estimated'`), but its money rides the session.tokens carrier the
 *     live path never sees, so the row shows up with zero tokens and either a
 *     0 or a null cost, and reads "--" through whichever leg it arrives on.
 *     The guard keys on throughput alone and does NOT gate on costScope; a
 *     genuine sub-cent spend still surfaces via the `> 0` leg.
 * A measured cost (including a real 0 alongside token throughput) renders "$0.00".
 */
export function liveCostLabel(costUsd: number | null, tokensTotal: number, decimals = 2): string {
  if (costUsd == null) return '--';
  return costUsd > 0 || tokensTotal > 0 ? formatCost(costUsd, decimals) : '--';
}

/**
 * The "needs you" live glance: a blocking permission prompt is the wedge's most
 * actionable live state. True only while genuinely blocked and not yet ended;
 * absent `awaitingInput` means not waiting. Strictly a live cue, never a rollup.
 */
export function liveNeedsYou(s: { awaitingInput?: boolean; status: string }): boolean {
  return s.awaitingInput === true && s.status !== 'ended';
}
