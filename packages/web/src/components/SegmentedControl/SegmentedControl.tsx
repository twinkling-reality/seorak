import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import styles from './SegmentedControl.module.css';

export type SegmentedControlButton = ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;

export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  renderOption,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  ariaLabel: string;
  renderOption?: (option: { value: T; label: ReactNode }, button: SegmentedControlButton) => ReactNode;
}) {
  return (
    <div className={styles.modeGroup} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const button = (
          <button
            type="button"
            className={option.value === value ? styles.buttonActive : styles.button}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
          >
            {option.label}
          </button>
        );
        const content = renderOption ? renderOption(option, button) : button;
        return <span key={option.value}>{content}</span>;
      })}
    </div>
  );
}
