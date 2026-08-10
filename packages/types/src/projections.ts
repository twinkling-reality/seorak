import type { Intervention } from "./intervention.ts";
import { priceModelUsage } from "./pricing.ts";
import type { SessionState } from "./session.ts";
import type { SessionSummary } from "./summary.ts";

const SCHEMA_VERSION = "5" as const;

interface SeorakSurfaceSnapshotBase {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  surfaceId: string;
  updatedAt: string;
  state:
    | "queued"
    | "active"
    | "paused"
    | "attention"
    | "bad_timing"
    | "completed";
}

export interface SeorakLiveActivitySnapshot
  extends SeorakSurfaceSnapshotBase {
  kind: "liveActivity";
  liveActivity: {
    title: string;
    body: string;
    progress: number;
    deepLink: string;
    modeLabel: string;
    contextLabel: string;
    statusLine: string;
    stage: "prompted" | "inProgress" | "completing";
    estimatedSeconds: number;
    morePartsCount: number;
  };
}

export interface SeorakNotificationSnapshot
  extends SeorakSurfaceSnapshotBase {
  kind: "notification";
  notification: {
    title: string;
    subtitle: string;
    body: string;
    deepLink: string;
    interruptionLevel: "passive" | "active" | "timeSensitive";
    category: string;
    threadId: string;
  };
}

export type SeorakLiveSurfaceSnapshot =
  | SeorakLiveActivitySnapshot
  | SeorakNotificationSnapshot;

/**
 * Project canonical session state into the full-fidelity view-model that
 * non-mobile surfaces (web dashboard, CLI) render. Unlike
 * `sessionToLiveActivity`, this carries true cumulative cost and the token
 * breakdown, and pulls in no `@mobile-surfaces` types — the seam stays clean
 * for surfaces that should not depend on the iOS contract.
 */
export function sessionToSummary(state: SessionState): SessionSummary {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.parse(state.lastEventAt) - Date.parse(state.startedAt)) / 1000),
  );
  const elapsedMinutes = elapsedSeconds / 60;
  const totalCostUsd = costFor(state);
  // Burn is unknowable when cost is. Guard the divide: `null / n` silently
  // coerces to 0 in JS, which would fabricate a $0/min for an unpriceable session.
  const burnRateUsdPerMin =
    totalCostUsd == null ? null : elapsedMinutes > 0 ? totalCostUsd / elapsedMinutes : 0;

  return {
    sessionId: state.sessionId,
    project: state.repoLabel,
    repoId: state.repoId,
    agent: state.agent,
    status: state.status,
    ...(state.member ? { member: state.member } : {}),
    startedAt: state.startedAt,
    lastEventAt: state.lastEventAt,
    ...(state.endedAt ? { endedAt: state.endedAt } : {}),
    elapsedSeconds,
    toolCallCount: state.toolCallCount,
    ...(state.currentTool ? { currentTool: state.currentTool } : {}),
    // Live-only "needs you" glance for the hero board; emitted only while blocked
    // (absent ⇒ not waiting). NEVER fed into an aggregate (summary.ts contract).
    ...(state.awaitingInput ? { awaitingInput: true } : {}),
    tokens: {
      input: state.totalInputTokens,
      output: state.totalOutputTokens,
      cacheRead: state.totalCacheReadTokens,
      cacheWrite: state.totalCacheWriteTokens,
      total: state.totalInputTokens + state.totalOutputTokens,
    },
    costUsd: totalCostUsd,
    burnRateUsdPerMin,
  };
}

/**
 * Project canonical session state into the live-ambient surface.
 * STATE-DRIVEN, not a metric stream: the headline is a warm state phrase (never a
 * live tok/cost ticker — that is dead-on-arrival on modern iOS and noise-shaped),
 * progress is honest-soft (deleted the $5 cost meter), and the push-gate
 * (`liveActivityFingerprint`) keys only on the discrete state — so token/cost churn
 * can never force a push. Trust boundary: only the repo basename + integer counts
 * ever appear. Fields the contract requires but the iOS ContentState does not render
 * (statusLine) stay a short honest status, never tokens/cost.
 */
export function sessionToLiveActivity(
  state: SessionState,
): SeorakLiveActivitySnapshot {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.parse(state.lastEventAt) - Date.parse(state.startedAt)) / 1000),
  );
  const dir = state.repoLabel || "session";
  const calls = state.toolCallCount;
  const needs = needsInput(state);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "liveActivity",
    id: `session-${state.sessionId}`,
    surfaceId: `session-${state.sessionId}`,
    updatedAt: state.lastEventAt,
    // needs-you lights the surface up (attention), overriding the silence-derived
    // status mapping — it is the highest-value glance (ADR-008).
    state: needs ? "attention" : liveActivityState(state),
    liveActivity: {
      title: liveActivityHeadline(state, elapsedSeconds, dir),
      // Subhead: basename + ONE honest count. Honest-empty — a just-started session
      // (0 calls) shows just the repo, never a fabricated "0 tok · $0.00".
      body:
        calls > 0
          ? `${dir}, ${calls} ${calls === 1 ? "tool call" : "tool calls"}`
          : dir,
      // Honest-soft progress (NOT a cost meter): pinned 1 on completion, otherwise 0
      // — the in-progress bar is rendered indeterminate/hidden on-device. Never cost.
      progress: state.status === "ended" ? 1 : 0,
      deepLink: `seorak://session/${state.sessionId}`,
      modeLabel: state.agent,
      contextLabel: dir,
      statusLine: needs
        ? "Waiting"
        : state.status === "ended"
          ? "Done"
          : state.status === "stuck"
            ? "Quiet"
            : "Working",
      stage: liveActivityStage(state),
      estimatedSeconds: elapsedSeconds,
      morePartsCount: 0,
    },
  };
}

/** Whether the agent is blocked awaiting the human (needs-you), and the session is
 *  still live. The highest-value glance (ADR-008): a real signal a silence-timer
 *  cannot fake. */
function needsInput(state: SessionState): boolean {
  return state.awaitingInput === true && state.status !== "ended";
}

/** The warm, state-driven headline. needs-you = "Waiting for you in <repo>";
 *  active/idle = "Working in <repo>"; stuck (quiet past the cron's threshold) =
 *  "Quiet in <repo>" (honest — we do not claim it is looping); ended = "Done in
 *  <elapsed>". No tool name, no tokens, no cost. */
function liveActivityHeadline(
  state: SessionState,
  elapsedSeconds: number,
  dir: string,
): string {
  if (needsInput(state)) return `Waiting for you in ${dir}`;
  switch (state.status) {
    case "ended":
      return `Done in ${formatElapsed(elapsedSeconds)}`;
    case "stuck":
      return `Quiet in ${dir}`;
    default:
      return `Working in ${dir}`;
  }
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The push-gate fingerprint for the live-ambient surface.
 * A live-activity push fires ONLY when this string changes, so it MUST encode only
 * the discrete, glanceable state (status + stage) and NEVER live token/cost numbers
 * — otherwise an incrementing counter would re-push on every ingest batch and blow
 * the (unpublished) ActivityKit per-hour budget. Two batches with the same
 * status+stage are a no-op for the live surface.
 */
export function liveActivityFingerprint(state: SessionState): string {
  return `${state.status}|${liveActivityStage(state)}|${needsInput(state) ? "need" : "ok"}`;
}

/**
 * The registered UNNotificationCategory id — the ONLY value in
 * `@mobile-surfaces` `NOTIFICATION_CATEGORY_IDS` and the app's generated
 * `notificationCategories`. Setting `notification.category` makes iOS invoke the
 * rich content extension; `toNotificationContentPayload` copies it to BOTH
 * `aps.category` AND the `liveSurface` sidecar, so it is purely the ROUTING id —
 * NOT a free human label (the slice's `category` is an enum locked to this set).
 * The human signal label therefore rides `subtitle`, which the content extension
 * (and standard system chrome) already render — no `@mobile-surfaces` change.
 */
const NOTIFICATION_CATEGORY = "surface-update";

/**
 * Project a fired `Intervention` into its notification surface.
 * PROJECT-AS-TITLE: the repo basename is the notification TITLE, the human
 * signal name is the SUBTITLE, and the warm one-sentence body is the BODY. The
 * interruption level is per-signal (carried on the intervention from the catalog,
 * never a hardcoded `cost_spike` branch); `category` invokes the content
 * extension. `session_ended` is the one calm wrap-up (a "completed" green-dot
 * state); every other signal is "attention".
 */
export function interventionToNotification(
  intervention: Intervention,
): SeorakNotificationSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "notification",
    id: `intervention-${intervention.sessionId}-${intervention.kind}-${intervention.triggeredAt}`,
    surfaceId: `session-${intervention.sessionId}`,
    updatedAt: intervention.triggeredAt,
    state: intervention.kind === "session_ended" ? "completed" : "attention",
    notification: {
      title: intervention.project,
      subtitle: intervention.signalLabel,
      body: intervention.body,
      deepLink: intervention.deepLink,
      interruptionLevel: intervention.interruptionLevel,
      category: NOTIFICATION_CATEGORY,
      threadId: `session-${intervention.sessionId}`,
    },
  };
}

function liveActivityState(
  state: SessionState,
): SeorakLiveSurfaceSnapshot["state"] {
  switch (state.status) {
    case "active":
      return "active";
    case "idle":
      return "paused";
    case "stuck":
      return "attention";
    case "ended":
      return "completed";
  }
}

function liveActivityStage(
  state: SessionState,
): "prompted" | "inProgress" | "completing" {
  if (state.status === "ended") return "completing";
  if (state.currentTool) return "inProgress";
  return "prompted";
}

/**
 * The session's authoritative cost (pricing unification, FOLLOW-UP #2). When the
 * reducer has accumulated per-model `modelTokens`, RE-PRICE from the shared
 * `pricing.ts` table so live / byAgent / projects / the KV headline all derive
 * cost from ONE source (a price change = a pricing.ts edit + worker deploy, no
 * collector fan-out). Falls back to the collector-priced `totalCostUsd` for legacy
 * KV rows / tool.calls that carried no `models[]`.
 *
 * Honesty: a tool whose capability set declares `cost: 'none'` CANNOT price its
 * work, so it reports null here (the worker's aggregation layer additionally
 * excludes it from every cost sum, so it never blends a $0). A session-costed tool
 * (`costScope: 'session'`) with no accumulated `modelTokens` is null too: its money
 * rides the `session.tokens` carrier in the event log, so the KV row's
 * `totalCostUsd` is a sum of schema-required per-call zeros, not a measurement. An
 * unpriced model contributes nothing (never a fabricated cost). The finite-number
 * coerce guards a legacy/corrupt `totalCostUsd` (null/stringified) from poisoning
 * the downstream sum with NaN.
 *
 * This reads `state.capabilities` DIRECTLY rather than going through
 * `resolveCapabilities`, for two reasons. It is shared by web and mobile, which
 * both re-derive cost client-side from a raw SessionState, so the check has to work
 * with nothing but the row. And `projection-contract.test.ts` proves `capabilities`
 * is web-only by statically scanning which fields this function names: route the
 * read through a helper and that guard silently stops covering it. An ABSENT
 * capability set is not `cost: 'none'`; it is a legacy row, and it prices normally.
 */
function costFor(state: SessionState): number | null {
  // null = this session CANNOT be priced (unknown); a numeric 0 = measured and
  // genuinely ~free. Collapsing the two into 0 (the old behaviour) fabricated a
  // "$0.00" for any token-priced-but-unpriceable session, which is exactly the
  // silent-zero the sibling rollups (ProjectRollup/AgentRollup/ModelRollup, all
  // number|null) already refuse. SessionSummary is the last field to align.
  if (state.capabilities?.cost === "none") return null;
  const modelTokens = state.modelTokens;
  if (modelTokens) {
    const models = Object.keys(modelTokens);
    if (models.length > 0) {
      let total = 0;
      let priced = false;
      for (const model of models) {
        const r = priceModelUsage(model, modelTokens[model]!);
        // Keep the priced flag: summing raw .costUsd would let a fully-unpriced
        // breakdown total to a silent 0. A row mixing priced + unpriced models
        // still reports the priced portion (priced flips true on the first hit).
        if (r.priced) {
          total += r.costUsd;
          priced = true;
        }
      }
      return priced ? total : null;
    }
  }
  // A session-costed tool (Codex, costScope 'session') carries its money on the
  // session.tokens carrier, which lives in the event log, not on this row. With
  // no model-token evidence here, `totalCostUsd` is the sum of schema-required
  // per-call zeros: a live Codex session hits exactly this shape, and falling
  // through would publish a fabricated $0 to every consumer of live[].
  if (state.capabilities?.costScope === "session") return null;
  // A finite collector figure is a real measurement (0 included). A non-finite /
  // absent one is unknown, not $0.
  return Number.isFinite(state.totalCostUsd) ? state.totalCostUsd : null;
}
