/**
 * live-activity-settings.ts — the Live Activity settings contract, the third family
 * in the generic D1 `settings` table alongside `capture` and `notifications`
 * and deliberately part of that one control plane. The web
 * Settings page and the mobile app both edit it through the one `GET/PUT /settings`
 * worker API; the worker reads it to decide whether to drive a Live Activity.
 *
 * Like notification settings, this is a SERVER decision (the worker starts/updates/
 * ends the activity), NOT something the collector enforces on-machine — the
 * collector never reads it.
 *
 * v1 ships exactly the minimum knobs that aren't dead controls (validation-first,
 * ADR-006/ADR-007): a master `enabled` (DEFAULT OFF until the dogfood gate passes)
 * and per-project mute (a muted repo never gets the focused activity). Cadence,
 * quiet-hours, the cost-footer toggle and a switcher are deferred — earned after the
 * gate, not shipped over an unvalidated surface.
 *
 * Fault-soft, defaulted: a missing row, a corrupt blob, or an un-migrated table all
 * read as the defaults via `coerceLiveActivitySettings`, so the table can never
 * silently turn the surface ON (it fails safe to OFF) or fabricate a mute.
 */

/** Per-project (keyed by SALTED repoId) override. v1 = mute only. */
export interface LiveActivityProjectOverride {
  muted: boolean;
}

export interface LiveActivitySettings {
  /** Master switch. DEFAULT OFF — the surface stays dark until the buyer flips it
   *  (and the validation gate authorises a wider rollout). */
  enabled: boolean;
  /** Per-project overrides keyed by the salted repoId (never the basename). A muted
   *  repo is never selected as the focused session. */
  perProject: Record<string, LiveActivityProjectOverride>;
}

export const DEFAULT_LIVE_ACTIVITY_SETTINGS: LiveActivitySettings = {
  enabled: false,
  perProject: {},
};

/**
 * Coerce an unknown (stored row, request body, fetched JSON) into a full
 * LiveActivitySettings, defaulting any missing/invalid field — including the whole
 * blob — to DEFAULT_LIVE_ACTIVITY_SETTINGS. Fault-soft and fail-safe: a corrupt
 * value resolves to `enabled:false` (the surface never turns itself on by accident),
 * and a malformed per-project entry resolves to NOT muted (a corrupt row can't
 * silently hide a repo). Mirrors `coerceCaptureSettings` / `coerceNotificationSettings`.
 */
export function coerceLiveActivitySettings(raw: unknown): LiveActivitySettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const enabled =
    typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_LIVE_ACTIVITY_SETTINGS.enabled;

  const perProject: Record<string, LiveActivityProjectOverride> = {};
  const rawPerProject = obj.perProject;
  if (rawPerProject && typeof rawPerProject === "object" && !Array.isArray(rawPerProject)) {
    for (const [repoId, value] of Object.entries(rawPerProject as Record<string, unknown>)) {
      const muted =
        value !== null &&
        typeof value === "object" &&
        (value as Record<string, unknown>).muted === true;
      perProject[repoId] = { muted };
    }
  }

  return { enabled, perProject };
}

/**
 * Whether the Live Activity surface is enabled for a given (salted) repoId: the
 * master switch is on AND the repo is not muted. The single gate the worker's focus
 * selection consults before starting/keeping an activity for a session.
 */
export function liveActivityEnabledFor(
  settings: LiveActivitySettings,
  repoId: string,
): boolean {
  if (!settings.enabled) return false;
  return !settings.perProject[repoId]?.muted;
}
