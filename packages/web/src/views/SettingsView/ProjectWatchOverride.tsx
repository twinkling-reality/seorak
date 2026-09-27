import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  SIGNAL_CATALOG,
  resolveProjectSignal,
  type InterventionThresholds,
  type NotificationSettings,
  type SignalId,
} from '@seorak/types';
import { thresholdBoundLead, thresholdBoundTail } from './alertSettingsCopy.js';
import styles from './SettingsView.module.css';

/*
 * One watch's PER-PROJECT override, on the web.
 *
 * The controls here are deliberately not the global ones. A global threshold
 * always has a value, so `AlertThresholdBound` requires a number and commits one.
 * A per-project threshold has three states — inherit, or a number, or the watch
 * turned off for this repo alone — and "empty" is a real, storable choice rather
 * than a validation failure. Reusing the global input would have meant either a
 * number that cannot be cleared, or teaching the global control an inherit state
 * it has no use for. Mobile drew the same line for the same reason
 * (`ProjectThresholdInput` beside `ThresholdInput`), so the two surfaces split
 * this the same way.
 *
 * What is NOT re-decided here is the precedence. `resolveProjectSignal` in
 * @seorak/types answers what this project's value currently is and which layer
 * set it, and the worker's engine resolves through the same function, so the
 * number this page shows as inherited is the number that would actually fire.
 */

interface ThresholdProps {
  signalLabel: string;
  thresholdKey: keyof InterventionThresholds;
  thresholdLabel: string;
  unit: string;
  signalId: SignalId;
  /** What this project uses today when it sets nothing of its own. */
  inherited: number;
  /** The stored per-project value, or undefined when it inherits. */
  override: number | undefined;
  disabled: boolean;
  onCommit: (value: number | undefined) => void;
}

function ProjectThresholdBound({
  signalLabel,
  thresholdKey,
  thresholdLabel,
  unit,
  signalId,
  inherited,
  override,
  disabled,
  onCommit,
}: ThresholdProps) {
  const [draft, setDraft] = useState(override === undefined ? '' : String(override));

  // Re-seed when the stored value changes underneath (an optimistic write that
  // rolled back, or a reload), the same discipline AlertThresholdBound uses.
  useEffect(() => {
    setDraft(override === undefined ? '' : String(override));
  }, [override]);

  function commitDraft(): void {
    const trimmed = draft.trim();
    // Empty is the INHERIT choice, not a rejected number. Anything non-positive
    // is a rejection and re-seeds, matching the coerce that would drop it anyway.
    if (trimmed === '') {
      setDraft('');
      if (override !== undefined) onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(override === undefined ? '' : String(override));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== override) onCommit(parsed);
  }

  return (
    <div className={styles.settingsBoundRow}>
      <span className={styles.settingsBoundLead}>
        {thresholdBoundLead(signalId, thresholdKey)}
      </span>
      <span className={styles.settingsBoundChip}>
        <input
          type="number"
          className={styles.settingsBoundInput}
          min={0}
          step="any"
          value={draft}
          disabled={disabled}
          placeholder={String(inherited)}
          aria-label={`${signalLabel} ${thresholdLabel} for this project`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </span>
      <span className={styles.settingsBoundTail}>
        {thresholdBoundTail(signalId, thresholdKey, unit)}
      </span>
    </div>
  );
}

interface Props {
  repoId: string;
  projectLabel: string;
  signalId: SignalId;
  settings: NotificationSettings;
  disabled: boolean;
  onEnable: (repoId: string, signalId: SignalId, value: boolean | undefined) => void;
  onThreshold: (
    repoId: string,
    signalId: SignalId,
    key: string,
    value: number | undefined,
  ) => void;
}

export default function ProjectWatchOverride({
  repoId,
  projectLabel,
  signalId,
  settings,
  disabled,
  onEnable,
  onThreshold,
}: Props) {
  const meta = SIGNAL_CATALOG[signalId];
  const resolved = resolveProjectSignal(settings, repoId, signalId);
  const stored = settings.perProject[repoId]?.overrides?.[signalId];
  const globalEnabled = settings.signals[signalId].enabled;

  const choices: { label: string; value: boolean | undefined }[] = [
    { label: `Inherit (${globalEnabled ? 'on' : 'off'})`, value: undefined },
    { label: 'On', value: true },
    { label: 'Off', value: false },
  ];

  return (
    <div className={styles.projectWatch} data-testid="alerts-project-watch">
      {/* Name plus, when it will not fire, why — in one line, because a row whose
          inputs are absent needs its reason where the eye already is. The phone
          says the same two things the same way. */}
      <span className={styles.projectWatchName}>
        {meta.label}
        {resolved.enabled
          ? ''
          : resolved.enabledSource === 'project'
            ? ' (off for this project)'
            : ' (off globally)'}
      </span>

      <div
        className={styles.projectWatchChoices}
        role="radiogroup"
        aria-label={`${meta.label} for ${projectLabel}`}
      >
        {choices.map((choice) => {
          const active = stored?.enabled === choice.value;
          return (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={active}
              className={clsx(
                styles.projectWatchChoice,
                active && styles.projectWatchChoiceOn,
              )}
              disabled={disabled}
              onClick={() => onEnable(repoId, signalId, choice.value)}
            >
              {choice.label}
            </button>
          );
        })}
      </div>

      {/* A threshold on a watch that cannot fire here is a dead control, so it is
          not rendered — the same rule the phone applies. The reason is said out
          loud instead, because a row that silently loses its inputs reads as a
          bug. */}
      {resolved.enabled
        ? meta.thresholds.map((t) => (
          <ProjectThresholdBound
            key={t.key}
            signalId={signalId}
            signalLabel={meta.label}
            thresholdKey={t.key}
            thresholdLabel={t.label}
            unit={t.unit}
            inherited={
              // The value this project uses today with nothing of its own set:
              // the global stored number when there is one, else the catalog
              // default. Both surfaces read the same one number.
              settings.signals[signalId].thresholds?.[t.key] ?? t.default
            }
            override={stored?.thresholds?.[t.key]}
            disabled={disabled}
            onCommit={(value) => onThreshold(repoId, signalId, t.key, value)}
          />
          ))
        : null}
    </div>
  );
}
