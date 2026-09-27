/**
 * notification-settings.ts — the shared customization control-plane contract.
 * Used by the worker (stores + serves + resolves it),
 * the web Settings page, and the mobile settings screen. Stored in the D1
 * `settings` table under key `notifications` (alongside `capture`).
 *
 * Unlike capture settings — which only ever REDUCE capture and are enforced
 * ON-MACHINE by the collector — notification settings are a SERVER decision: the
 * intervention evaluation runs in the worker, so the cron/ingest reads these.
 * The collector never reads `notifications` (§F).
 *
 * Fault-soft, catalog-defaulted: `coerceNotificationSettings` falls every
 * missing/invalid field back to the SIGNAL CATALOG default, so a corrupt or
 * partial row can never silently disable a default-on watch or fabricate one
 * (the same discipline as `coerceCaptureSettings`). Thresholds coerce to finite
 * POSITIVE numbers so a fat-fingered 0/NaN can't disable the wedge.
 */
import { SIGNAL_CATALOG, SIGNAL_IDS, isSignalId } from "./notification-catalog.ts";
import type { SignalId } from "./intervention.ts";

/** A signal's stored config. `enabled` is always resolved (the UI toggle reads
 *  it); `thresholds` + `alwaysNotify` stay SPARSE — absent means "use the catalog
 *  default" (so a catalog default change still reaches an already-stored row, and
 *  a consumer renders `stored ?? catalogDefault`). Thresholds are keyed by the
 *  catalog threshold keys (== `InterventionThresholds` field names). */
export interface SignalConfig {
  enabled: boolean;
  thresholds?: Record<string, number>;
  /** Break through quiet hours; absent → the catalog `defaultAlwaysNotify`. */
  alwaysNotify?: boolean;
}

/** Quiet hours — a daily window in which non-`alwaysNotify` pushes are HELD
 *  (still recorded to history, §D). `start`/`end` are "HH:MM" 24h local to `tz`
 *  (an IANA zone, e.g. "America/Los_Angeles"); a window may wrap past midnight
 *  (start "22:00" > end "08:00"). */
export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  tz: string;
}

/** A per-project override. `muted` suppresses EVERY signal for that repo;
 *  `overrides` field-level-tweaks individual signals (any subset of fields) on
 *  top of the global config. Keyed by the salted `repoId` (the UI labels rows
 *  with the basename `repoLabel`; privacy holds, §D). */
export interface ProjectOverride {
  muted: boolean;
  overrides?: Partial<Record<SignalId, Partial<SignalConfig>>>;
}

export interface NotificationSettings {
  /** Every catalog signal is always present (coerce guarantees it). */
  signals: Record<SignalId, SignalConfig>;
  quietHours: QuietHours;
  /** repoId → override. Empty by default. */
  perProject: Record<string, ProjectOverride>;
  /** Shared work defaults to the session's member. "everyone" is the explicit
   *  notify-us choice and is never inferred from workspace membership. */
  workspaceDelivery: "responsible" | "everyone";
}

/** Sane quiet-hours default: OFF, 22:00–08:00 UTC. The cron runs in UTC; the
 *  device can write its own tz when the user turns quiet hours on (§8.3). */
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  start: "22:00",
  end: "08:00",
  tz: "UTC",
};

/** The full default settings, derived from the catalog: each signal carries just
 *  its `defaultEnabled` (thresholds/alwaysNotify left to the catalog), quiet hours
 *  off, no per-project overrides. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  signals: Object.fromEntries(
    SIGNAL_IDS.map((id) => [id, { enabled: SIGNAL_CATALOG[id].defaultEnabled }]),
  ) as Record<SignalId, SignalConfig>,
  quietHours: { ...DEFAULT_QUIET_HOURS },
  perProject: {},
  workspaceDelivery: "responsible",
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** A finite, POSITIVE number, else undefined — a 0/negative/NaN threshold is
 *  rejected (it would disable or corrupt the bound, mirroring the worker's
 *  `positiveOr`). */
function positiveOrUndefined(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Coerce a stored thresholds blob to the valid positive overrides for `id`'s
 *  catalog threshold keys ONLY (an unknown/foreign key is dropped). Returns
 *  undefined when nothing valid remains, so the config stays sparse. */
function coerceThresholds(raw: unknown, id: SignalId): Record<string, number> | undefined {
  const obj = asObject(raw);
  const out: Record<string, number> = {};
  for (const meta of SIGNAL_CATALOG[id].thresholds) {
    const v = positiveOrUndefined(obj[meta.key]);
    if (v !== undefined) out[meta.key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce one signal's stored config — `enabled` defaults to the catalog,
 *  thresholds/alwaysNotify stay sparse (absent → catalog default downstream). */
function coerceSignalConfig(raw: unknown, id: SignalId): SignalConfig {
  const obj = asObject(raw);
  const thresholds = coerceThresholds(obj.thresholds, id);
  const out: SignalConfig = {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : SIGNAL_CATALOG[id].defaultEnabled,
  };
  if (thresholds) out.thresholds = thresholds;
  if (typeof obj.alwaysNotify === "boolean") out.alwaysNotify = obj.alwaysNotify;
  return out;
}

/** Coerce a PER-PROJECT signal override — every field optional (a project may
 *  tweak just one). Returns undefined when nothing valid was set (drop it). */
function coerceSignalOverride(raw: unknown, id: SignalId): Partial<SignalConfig> | undefined {
  const obj = asObject(raw);
  const thresholds = coerceThresholds(obj.thresholds, id);
  const out: Partial<SignalConfig> = {};
  if (typeof obj.enabled === "boolean") out.enabled = obj.enabled;
  if (thresholds) out.thresholds = thresholds;
  if (typeof obj.alwaysNotify === "boolean") out.alwaysNotify = obj.alwaysNotify;
  return Object.keys(out).length > 0 ? out : undefined;
}

function coerceSignals(raw: unknown): Record<SignalId, SignalConfig> {
  const obj = asObject(raw);
  return Object.fromEntries(
    SIGNAL_IDS.map((id) => [id, coerceSignalConfig(obj[id], id)]),
  ) as Record<SignalId, SignalConfig>;
}

function coerceQuietHours(raw: unknown): QuietHours {
  const obj = asObject(raw);
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_QUIET_HOURS.enabled,
    start: typeof obj.start === "string" && HH_MM.test(obj.start) ? obj.start : DEFAULT_QUIET_HOURS.start,
    end: typeof obj.end === "string" && HH_MM.test(obj.end) ? obj.end : DEFAULT_QUIET_HOURS.end,
    tz: typeof obj.tz === "string" && obj.tz.length > 0 ? obj.tz : DEFAULT_QUIET_HOURS.tz,
  };
}

function coercePerProject(raw: unknown): Record<string, ProjectOverride> {
  const obj = asObject(raw);
  const out: Record<string, ProjectOverride> = {};
  for (const [repoId, value] of Object.entries(obj)) {
    const entry = asObject(value);
    const overridesRaw = asObject(entry.overrides);
    const overrides: Partial<Record<SignalId, Partial<SignalConfig>>> = {};
    for (const [sid, ov] of Object.entries(overridesRaw)) {
      if (!isSignalId(sid)) continue; // drop unknown/stale signal keys
      const coerced = coerceSignalOverride(ov, sid);
      if (coerced) overrides[sid] = coerced;
    }
    const muted = typeof entry.muted === "boolean" ? entry.muted : false;
    const hasOverrides = Object.keys(overrides).length > 0;
    // Keep only entries that actually say something (muted, or a real override) —
    // a bare `{muted:false}` carries no information and would just grow the blob.
    if (muted || hasOverrides) {
      out[repoId] = hasOverrides ? { muted, overrides } : { muted };
    }
  }
  return out;
}

/** Which stored layer decided a resolved value. `"catalog"` means no layer set
 *  it and the reader falls back to its own seed. */
export type SignalSettingSource = "project" | "global" | "catalog";

/**
 * One (repo, signal) resolved across the STORED layers only.
 *
 * The precedence — project override, then global, then nothing — is one rule
 * that three consumers need: the worker evaluates it, and both UIs have to show
 * what it decided and where the value came from. It was written three times
 * (authoritatively in `resolveNotificationConfig`, partially in the mobile watch
 * controls, and not at all for per-project in web), which is how two surfaces
 * come to disagree about what "off" means without either being edited.
 *
 * `thresholds` is deliberately SPARSE: it carries only the catalog keys a stored
 * layer actually set. What an unset key falls through to is the reader's, not
 * this function's — the worker falls through to its env-tuned seed, and a UI to
 * the catalog default. Resolving that here would either force the env seed into
 * a publish-safe package or silently drop it from the engine.
 *
 * This resolves settings against settings. It measures nothing and compares
 * nothing measured, which is what keeps it on the publish-safe side of CLAUDE.md
 * rule 2 (`npm run types-boundary:check` is the authority, not this comment).
 */
export interface ResolvedProjectSignal {
  /** Whether this signal may fire for this repo. Always false when the repo is
   *  muted, whatever the layers say. */
  enabled: boolean;
  /** Which layer decided `enabled`, BEFORE the mute short-circuit — so a reader
   *  can distinguish "off for this project" from "off globally" while a mute is
   *  also in force. */
  enabledSource: SignalSettingSource;
  /** The repo's master switch. `enabled` is false whenever this is true. */
  muted: boolean;
  alwaysNotify: boolean;
  alwaysNotifySource: SignalSettingSource;
  /** Sparse — only keys a stored layer set. */
  thresholds: Record<string, number>;
  /** Same keys as `thresholds`, never `"catalog"`. */
  thresholdSources: Record<string, Exclude<SignalSettingSource, "catalog">>;
}

export function resolveProjectSignal(
  settings: NotificationSettings,
  repoId: string,
  signalId: SignalId,
): ResolvedProjectSignal {
  const meta = SIGNAL_CATALOG[signalId];
  const project = settings.perProject[repoId];
  const override = project?.overrides?.[signalId];
  const global = settings.signals[signalId];
  const muted = project?.muted ?? false;

  const enabledSource: SignalSettingSource =
    override?.enabled !== undefined
      ? "project"
      : global?.enabled !== undefined
        ? "global"
        : "catalog";
  const baseEnabled =
    override?.enabled ?? global?.enabled ?? meta.defaultEnabled;

  const alwaysNotifySource: SignalSettingSource =
    override?.alwaysNotify !== undefined
      ? "project"
      : global?.alwaysNotify !== undefined
        ? "global"
        : "catalog";

  const thresholds: Record<string, number> = {};
  const thresholdSources: Record<string, "project" | "global"> = {};
  for (const t of meta.thresholds) {
    const fromProject = override?.thresholds?.[t.key];
    if (typeof fromProject === "number") {
      thresholds[t.key] = fromProject;
      thresholdSources[t.key] = "project";
      continue;
    }
    const fromGlobal = global?.thresholds?.[t.key];
    if (typeof fromGlobal === "number") {
      thresholds[t.key] = fromGlobal;
      thresholdSources[t.key] = "global";
    }
  }

  return {
    enabled: muted ? false : baseEnabled,
    enabledSource,
    muted,
    alwaysNotify:
      override?.alwaysNotify ?? global?.alwaysNotify ?? meta.defaultAlwaysNotify,
    alwaysNotifySource,
    thresholds,
    thresholdSources,
  };
}

/**
 * Coerce an unknown (stored row, request body, fetched JSON) into a full
 * NotificationSettings, defaulting any missing/invalid field to its catalog
 * default. Fault-soft: a corrupt/partial row reads as the catalog defaults, never
 * silently disabling a default-on watch or fabricating one. Shared by the
 * worker's read/write paths, the web, and the mobile app so every consumer
 * resolves partial/corrupt data identically.
 */
export function coerceNotificationSettings(raw: unknown): NotificationSettings {
  const obj = asObject(raw);
  return {
    signals: coerceSignals(obj.signals),
    quietHours: coerceQuietHours(obj.quietHours),
    perProject: coercePerProject(obj.perProject),
    workspaceDelivery:
      obj.workspaceDelivery === "everyone" ? "everyone" : "responsible",
  };
}
