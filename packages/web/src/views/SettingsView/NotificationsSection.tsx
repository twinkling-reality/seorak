import { useMemo } from 'react';
import clsx from 'clsx';
import {
  SIGNAL_CATALOG,
  SIGNAL_IDS,
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationAvailabilityExplanation,
  PROJECT_TUNABLE_SIGNAL_IDS,
  resolveNotificationAvailability,
  type NotificationSettings,
  type SignalConfig,
  type SignalId,
} from '@seorak/types';
import {
  fetchNotificationSettings,
  updateNotificationSettings,
} from '../../lib/api.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useSettingsSection } from '../../hooks/useSettingsSection.js';
import { useWorkspaceContext } from '../../lib/workspaceContext.js';
import AlertThresholdBound from './AlertThresholdBound.js';
import ProjectWatchOverride from './ProjectWatchOverride.js';
import {
  QUIET_HOURS_PROMPT,
  WATCH_PROMPTS,
  projectMutePrompt,
} from './alertSettingsCopy.js';
import styles from './SettingsView.module.css';

/*
 * Alert settings — per-signal on/off + thresholds, quiet hours, and per-project
 * mutes the worker reads when it evaluates the wedge. No read-only panels;
 * sections render only when they contain at least one control.
 *
 * Load, optimistic write, 401 read-only, and rollback are the shared
 * useSettingsSection machine; this file supplies the notifications family.
 *
 * Control visibility:
 *   - loading: status line only (no disabled switches that imply editability)
 *   - ready: profileRow toggles and inputs, active unless readOnly
 *   - demo: defaults in-memory, changes flip locally (no worker PUT)
 *   - unavailable (worker missing): one reason line, no toggles
 *   - readOnly (401 on write): controls stay visible but disabled, key hint shown
 */

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function effectiveThreshold(config: SignalConfig | undefined, key: string, fallback: number): number {
  return config?.thresholds?.[key] ?? fallback;
}

interface Props {
  onSettingsChange?: (settings: NotificationSettings) => void;
}

export default function NotificationsSection({ onSettingsChange }: Props) {
  const workspace = useWorkspaceContext();
  const { state, applyChange } = useSettingsSection<NotificationSettings>({
    load: fetchNotificationSettings,
    demoData: DEFAULT_NOTIFICATION_SETTINGS,
    unavailableReason: 'Worker unreachable. Notification controls need a running worker.',
    readOnlyNote:
      "This access token can read this worker, but it can't change notification settings. Sign in with the worker's owner token to make changes here.",
    logLabel: 'notification settings',
    onChange: onSettingsChange,
  });

  const overview = usePollingStore((s) => s.overviewData);
  const projects = overview?.usage.projects ?? [];
  const availability = useMemo(
    () => resolveNotificationAvailability(
      overview?.notificationAvailability,
      overview?.tools.byAgent ?? [],
    ),
    [overview],
  );

  function write(
    optimistic: NotificationSettings,
    patch: Parameters<typeof updateNotificationSettings>[0],
  ): void {
    if (state.kind !== 'ready') return;
    const prev = state.data;
    applyChange({
      optimistic,
      write: () => updateNotificationSettings(patch),
      rollback: () => prev,
      savedNote: 'Saved. The worker applies this on the next evaluation.',
    });
  }

  function toggleSignal(id: SignalId): void {
    if (state.kind !== 'ready') return;
    const current = state.data.signals[id];
    const nextConfig: SignalConfig = { ...current, enabled: !current.enabled };
    write(
      { ...state.data, signals: { ...state.data.signals, [id]: nextConfig } },
      { signals: { [id]: nextConfig } },
    );
  }

  function setThreshold(id: SignalId, key: string, raw: string): void {
    if (state.kind !== 'ready') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const current = state.data.signals[id];
    const nextConfig: SignalConfig = {
      ...current,
      thresholds: { ...current.thresholds, [key]: value },
    };
    write(
      { ...state.data, signals: { ...state.data.signals, [id]: nextConfig } },
      { signals: { [id]: nextConfig } },
    );
  }

  function setQuietHours(next: NotificationSettings['quietHours']): void {
    if (state.kind !== 'ready') return;
    write({ ...state.data, quietHours: next }, { quietHours: next });
  }

  function toggleProjectMute(repoId: string): void {
    if (state.kind !== 'ready' || !repoId) return;
    const current = state.data.perProject[repoId];
    const nextOverride = { ...current, muted: !current?.muted };
    write(
      { ...state.data, perProject: { ...state.data.perProject, [repoId]: nextOverride } },
      { perProject: { [repoId]: nextOverride } },
    );
  }

  /**
   * Write one per-project override, as two different shapes of the same edit.
   *
   * The optimistic value is the settings object as it will BE, with removed keys
   * genuinely gone, because that is what the page has to render immediately. The
   * patch is the settings object as it must be SAID: the worker deep-merges, so
   * omitting a key means "leave it alone" and a removal has to be spelled `null`.
   * Building one from the other would lose exactly the edit that matters — the
   * per-project override that goes back to inherited.
   */
  function writeProjectOverride(
    repoId: string,
    id: SignalId,
    next: Partial<SignalConfig>,
    tombstones: Record<string, unknown>,
  ): void {
    if (state.kind !== 'ready' || !repoId) return;
    const project = state.data.perProject[repoId];
    const muted = project?.muted ?? false;

    const overrides = { ...project?.overrides };
    if (Object.keys(next).length > 0) overrides[id] = next;
    else delete overrides[id];
    const optimisticProject =
      Object.keys(overrides).length > 0 ? { muted, overrides } : { muted };

    // `null` on the signal itself when nothing of it survives; otherwise the
    // surviving fields plus a tombstone per removed one.
    const signalPatch =
      Object.keys(next).length > 0 ? { ...next, ...tombstones } : null;

    write(
      {
        ...state.data,
        perProject: { ...state.data.perProject, [repoId]: optimisticProject },
      },
      { perProject: { [repoId]: { muted, overrides: { [id]: signalPatch } } } },
    );
  }

  function setProjectEnabled(repoId: string, id: SignalId, value: boolean | undefined): void {
    if (state.kind !== 'ready') return;
    const current = state.data.perProject[repoId]?.overrides?.[id] ?? {};
    const next = { ...current };
    if (value === undefined) delete next.enabled;
    else next.enabled = value;
    writeProjectOverride(repoId, id, next, value === undefined ? { enabled: null } : {});
  }

  function setProjectThreshold(
    repoId: string,
    id: SignalId,
    key: string,
    value: number | undefined,
  ): void {
    if (state.kind !== 'ready') return;
    const current = state.data.perProject[repoId]?.overrides?.[id] ?? {};
    const thresholds = { ...current.thresholds };
    if (value === undefined) delete thresholds[key];
    else thresholds[key] = value;
    const next = { ...current };
    if (Object.keys(thresholds).length > 0) next.thresholds = thresholds;
    else delete next.thresholds;
    // A cleared threshold is a tombstone on the KEY, not on the thresholds
    // object: the signal's other bounds must survive it.
    writeProjectOverride(
      repoId,
      id,
      next,
      value === undefined ? { thresholds: { [key]: null } } : {},
    );
  }

  function toggleWorkspaceDelivery(): void {
    if (state.kind !== 'ready') return;
    const workspaceDelivery =
      state.data.workspaceDelivery === 'everyone'
        ? 'responsible'
        : 'everyone';
    write(
      { ...state.data, workspaceDelivery },
      { workspaceDelivery },
    );
  }

  const settings = state.kind === 'ready' ? state.data : DEFAULT_NOTIFICATION_SETTINGS;
  const controlsDisabled = state.kind !== 'ready' || state.readOnly;
  const quiet = settings.quietHours;

  const projectRows = Array.from(
    new Map(projects.filter((p) => p.repoId).map((p) => [p.repoId, p])).values(),
  );

  if (state.kind === 'unavailable') {
    return <span className={styles.settingsUnavailable}>{state.reason}</span>;
  }

  if (state.kind === 'loading') {
    return <span className={styles.notifyEmpty}>Loading…</span>;
  }

  return (
    <div className={styles.settingsPanel} data-testid="alerts-controls">
      {SIGNAL_IDS.map((id) => {
        const meta = SIGNAL_CATALOG[id];
        const config = settings.signals[id];
        const enabled = config?.enabled ?? meta.defaultEnabled;
        const watchAvailability = availability.signals[id];
        const canFire = watchAvailability.state === 'available';
        const effectiveEnabled = enabled && canFire;
        const availabilityCopy = notificationAvailabilityExplanation(
          id,
          watchAvailability.state,
        );
        return (
          <div
            key={id}
            className={styles.settingsRowGroup}
            data-testid="alerts-watch-row"
            data-availability={watchAvailability.state}
          >
            <button
              type="button"
              className={styles.settingsRow}
              role="switch"
              aria-checked={effectiveEnabled}
              aria-label={`${meta.label} notifications`}
              disabled={controlsDisabled || !canFire}
              onClick={() => toggleSignal(id)}
            >
              <span className={styles.settingsRowLabel}>{WATCH_PROMPTS[id]}</span>
              <span
                className={clsx(
                  styles.settingsRowSwitch,
                  effectiveEnabled && styles.settingsRowSwitchOn,
                )}
                aria-hidden
              />
            </button>
            {availabilityCopy ? (
              <div className={styles.settingsRowDetail}>{availabilityCopy}</div>
            ) : null}
            {effectiveEnabled && meta.thresholds.length > 0 ? (
              <div className={styles.settingsRowDetail}>
                {meta.thresholds.map((t) => (
                  <AlertThresholdBound
                    key={t.key}
                    signalId={id}
                    signalLabel={meta.label}
                    thresholdKey={t.key}
                    thresholdLabel={t.label}
                    unit={t.unit}
                    value={effectiveThreshold(config, t.key, t.default)}
                    disabled={controlsDisabled || !canFire}
                    onChange={(raw) => setThreshold(id, t.key, raw)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {workspace?.mode === 'workspace' ? (
        <div className={styles.settingsRowGroup} data-testid="alerts-workspace-delivery-row">
          <button
            type="button"
            className={styles.settingsRow}
            role="switch"
            aria-checked={settings.workspaceDelivery === 'everyone'}
            aria-label="Notify everyone in this workspace"
            disabled={controlsDisabled}
            onClick={toggleWorkspaceDelivery}
          >
            <span className={styles.settingsRowLabel}>
              Notify everyone when shared work needs attention
            </span>
            <span
              className={clsx(
                styles.settingsRowSwitch,
                settings.workspaceDelivery === 'everyone' &&
                  styles.settingsRowSwitchOn,
              )}
              aria-hidden
            />
          </button>
          <div className={styles.settingsRowDetail}>
            By default, only the person responsible for the session is notified.
          </div>
        </div>
      ) : null}

      <div className={styles.settingsRowGroup} data-testid="alerts-quiet-row">
        <button
          type="button"
          className={styles.settingsRow}
          role="switch"
          aria-checked={quiet.enabled}
          aria-label="Quiet hours"
          disabled={controlsDisabled}
          onClick={() => setQuietHours({ ...quiet, enabled: !quiet.enabled })}
        >
          <span className={styles.settingsRowLabel}>{QUIET_HOURS_PROMPT}</span>
          <span
            className={clsx(styles.settingsRowSwitch, quiet.enabled && styles.settingsRowSwitchOn)}
            aria-hidden
          />
        </button>
        {quiet.enabled ? (
          <div className={styles.settingsRowDetail}>
            <div className={styles.settingsBoundFields}>
              <label className={styles.settingsBoundRow}>
                <span className={styles.settingsBoundLead}>From</span>
                <span className={clsx(styles.settingsBoundChip, styles.settingsBoundChipWide)}>
                  <input
                    type="time"
                    className={styles.settingsBoundTime}
                    value={quiet.start}
                    disabled={controlsDisabled}
                    aria-label="Quiet hours start"
                    onChange={(e) => setQuietHours({ ...quiet, start: e.target.value })}
                  />
                </span>
              </label>
              <label className={styles.settingsBoundRow}>
                <span className={styles.settingsBoundLead}>To</span>
                <span className={clsx(styles.settingsBoundChip, styles.settingsBoundChipWide)}>
                  <input
                    type="time"
                    className={styles.settingsBoundTime}
                    value={quiet.end}
                    disabled={controlsDisabled}
                    aria-label="Quiet hours end"
                    onChange={(e) => setQuietHours({ ...quiet, end: e.target.value })}
                  />
                </span>
              </label>
              <label className={styles.settingsBoundRow}>
                <span className={styles.settingsBoundLead}>In</span>
                <span
                  className={clsx(
                    styles.settingsBoundChip,
                    styles.settingsBoundChipWide,
                    styles.settingsBoundChipSelect,
                  )}
                >
                  <select
                    className={styles.settingsBoundSelect}
                    value={quiet.tz}
                    disabled={controlsDisabled}
                    aria-label="Quiet hours timezone"
                    onChange={(e) => setQuietHours({ ...quiet, tz: e.target.value })}
                  >
                    {TIMEZONES.includes(quiet.tz) ? null : (
                      <option value={quiet.tz}>{quiet.tz}</option>
                    )}
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
          </div>
        ) : null}
      </div>

      {projectRows.map((p) => {
        const muted = settings.perProject[p.repoId]?.muted ?? false;
        const projectLabel = p.project || p.repoId;
        return (
          <div key={p.repoId} className={styles.settingsRowGroup} data-testid="alerts-project-row">
            <button
              type="button"
              className={styles.settingsRow}
              role="switch"
              aria-checked={muted}
              aria-label={`Mute ${projectLabel}`}
              disabled={controlsDisabled}
              onClick={() => toggleProjectMute(p.repoId)}
            >
              <span className={styles.settingsRowLabel}>{projectMutePrompt(projectLabel)}</span>
              <span
                className={clsx(styles.settingsRowSwitch, muted && styles.settingsRowSwitchOn)}
                aria-hidden
              />
            </button>
            {/* Mute is the master, so while it is on every control below it is
                dead. The phone hides them for that reason and so does this: no
                control on this page does nothing. */}
            {muted ? null : (
              <div className={styles.settingsRowDetail}>
                {PROJECT_TUNABLE_SIGNAL_IDS.map((id) => (
                  <ProjectWatchOverride
                    key={id}
                    repoId={p.repoId}
                    projectLabel={projectLabel}
                    signalId={id}
                    settings={settings}
                    disabled={controlsDisabled}
                    onEnable={setProjectEnabled}
                    onThreshold={setProjectThreshold}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {state.note ? <span className={styles.feedback}>{state.note}</span> : null}
    </div>
  );
}
