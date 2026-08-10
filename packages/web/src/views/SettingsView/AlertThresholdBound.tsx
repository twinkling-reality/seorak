import { useEffect, useState } from 'react';
import type { InterventionThresholds, SignalId } from '@seorak/types';
import styles from './SettingsView.module.css';
import { thresholdBoundLead, thresholdBoundTail } from './alertSettingsCopy.js';

interface Props {
  signalId: SignalId;
  signalLabel: string;
  thresholdKey: keyof InterventionThresholds;
  thresholdLabel: string;
  unit: string;
  value: number;
  disabled: boolean;
  onChange: (raw: string) => void;
}

export default function AlertThresholdBound({
  signalId,
  signalLabel,
  thresholdKey,
  thresholdLabel,
  unit,
  value,
  disabled,
  onChange,
}: Props) {
  const lead = thresholdBoundLead(signalId, thresholdKey);
  const tail = thresholdBoundTail(signalId, thresholdKey, unit);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commitDraft(): void {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(value));
      return;
    }
    const normalized = String(parsed);
    setDraft(normalized);
    if (parsed !== value) onChange(normalized);
  }

  return (
    <div className={styles.settingsBoundRow}>
      <span className={styles.settingsBoundLead}>{lead}</span>
      <span className={styles.settingsBoundChip}>
        <input
          type="number"
          className={styles.settingsBoundInput}
          min={0}
          step="any"
          value={draft}
          disabled={disabled}
          aria-label={`${signalLabel} ${thresholdLabel}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />
      </span>
      <span className={styles.settingsBoundTail}>{tail}</span>
    </div>
  );
}
