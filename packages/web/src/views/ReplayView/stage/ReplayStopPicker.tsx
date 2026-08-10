import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

import { PauseIcon } from '../replayIcons.js';
import type { ReplayStopMode } from '../replayReviewModel.js';
import styles from './ReplayStopPicker.module.css';

export const STOP_MODE_OPTIONS: ReadonlyArray<{
  mode: ReplayStopMode;
  label: string;
  hint: string;
}> = [
  {
    mode: 'off',
    label: 'Continuous',
    hint: 'Keep playing with no auto-pauses while you watch.',
  },
  {
    mode: 'highlights',
    label: 'Highlights',
    hint: 'Pause at errors, peaks, commits, and other worth-revisiting moments.',
  },
  {
    mode: 'moments',
    label: 'All moments',
    hint: 'Pause at every captured moment, including routine tool calls.',
  },
];

function labelFor(mode: ReplayStopMode): string {
  return STOP_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

/** Trigger copy that reads as a control without opening the menu. */
export function stopModeTriggerLabel(mode: ReplayStopMode): string {
  if (mode === 'off') return 'Continuous';
  return `Auto-pause, ${labelFor(mode)}`;
}

function stopModeTriggerAriaLabel(mode: ReplayStopMode): string {
  if (mode === 'off') return 'Playback continuous, no auto-pause';
  return `Auto-pause at ${labelFor(mode).toLowerCase()}`;
}

export default function ReplayStopPicker({
  value,
  onChange,
}: {
  value: ReplayStopMode;
  onChange: (mode: ReplayStopMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const listenId = window.setTimeout(() => {
      window.addEventListener('click', onClickOutside);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(listenId);
      window.removeEventListener('click', onClickOutside);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx(styles.picker, open && styles.pickerOpen)}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={stopModeTriggerAriaLabel(value)}
        onClick={() => setOpen((current) => !current)}
      >
        {value !== 'off' ? (
          <span className={styles.triggerIcon} aria-hidden="true">
            <PauseIcon />
          </span>
        ) : null}
        <span className={styles.triggerText}>{stopModeTriggerLabel(value)}</span>
      </button>

      {open ? (
        <div className={styles.menu} role="menu" aria-label="Replay pause behavior">
          {STOP_MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              className={clsx(styles.option, option.mode === value && styles.optionActive)}
              aria-checked={option.mode === value}
              onClick={() => {
                onChange(option.mode);
                setOpen(false);
              }}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              <span className={styles.optionHint}>{option.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
