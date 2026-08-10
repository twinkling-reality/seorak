import clsx from 'clsx';
import { DEFAULT_CAPTURE_SETTINGS, type CaptureSettings } from '@seorak/types';
import { fetchCaptureSettings, updateCaptureSettings } from '../../lib/api.js';
import { useSettingsSection } from '../../hooks/useSettingsSection.js';
import { CAPTURE_PROMPTS } from './captureSettingsCopy.js';
import styles from './SettingsView.module.css';

/*
 * Capture settings — live toggles round-tripped through the worker (PUT /settings)
 * and enforced on the collector's local cache. Each row is a plain-English sentence
 * paired with its switch so the control is obvious.
 *
 * Load, optimistic write, 401 read-only, and rollback are the shared
 * useSettingsSection machine; this file supplies the capture family and its copy.
 *
 * Control visibility:
 *   - loading: status line only (no disabled switches that imply editability)
 *   - ready: sentence + toggle rows, active unless readOnly
 *   - demo: defaults in-memory, toggles flip locally (no worker PUT)
 *   - unavailable (worker missing): one reason line, no toggles
 *   - readOnly (401 on write): toggles stay visible but disabled, key hint shown
 */

interface ToggleRowDef {
  key: keyof CaptureSettings;
}

const TOGGLE_ROWS: ToggleRowDef[] = [
  { key: 'lineCounts' },
  { key: 'gitMomentum' },
  { key: 'fileSignals' },
  { key: 'fileLabels' },
];

interface Props {
  onSettingsChange?: (settings: CaptureSettings) => void;
}

export default function CaptureSection({ onSettingsChange }: Props) {
  const { state, applyChange } = useSettingsSection<CaptureSettings>({
    load: fetchCaptureSettings,
    demoData: DEFAULT_CAPTURE_SETTINGS,
    unavailableReason: 'Worker unreachable — capture controls need a running worker.',
    readOnlyNote:
      "This access token can read this worker, but it can't change capture settings. Sign in with the worker's owner token to make changes here.",
    logLabel: 'capture settings',
    onChange: onSettingsChange,
  });

  function toggle(key: keyof CaptureSettings): void {
    if (state.kind !== 'ready') return;
    const next = !state.data[key];
    applyChange({
      optimistic: { ...state.data, [key]: next },
      write: () => updateCaptureSettings({ [key]: next }),
      // Revert only this switch, so a second toggle made while this one was in
      // flight keeps its optimistic value.
      rollback: (latest) => ({ ...latest, [key]: !next }),
      savedNote: 'Saved — your collector picks this up within a few minutes.',
    });
  }

  const settings = state.kind === 'ready' ? state.data : DEFAULT_CAPTURE_SETTINGS;
  const controlsDisabled = state.kind !== 'ready' || state.readOnly;

  if (state.kind === 'unavailable') {
    return <span className={styles.settingsUnavailable}>{state.reason}</span>;
  }

  if (state.kind === 'loading') {
    return <span className={styles.notifyEmpty}>Loading…</span>;
  }

  return (
    <div className={styles.settingsPanel} data-testid="capture-controls">
      {TOGGLE_ROWS.map((row) => (
        <div key={row.key} className={styles.settingsRowGroup} data-testid="capture-toggle-row">
          <button
            type="button"
            className={styles.settingsRow}
            role="switch"
            aria-checked={settings[row.key]}
            aria-label={CAPTURE_PROMPTS[row.key]}
            disabled={controlsDisabled}
            onClick={() => toggle(row.key)}
          >
            <span className={styles.settingsRowLabel}>{CAPTURE_PROMPTS[row.key]}</span>
            <span
              className={clsx(
                styles.settingsRowSwitch,
                settings[row.key] && styles.settingsRowSwitchOn,
              )}
              aria-hidden
            />
          </button>
        </div>
      ))}
      {state.note ? <span className={styles.feedback}>{state.note}</span> : null}
    </div>
  );
}
