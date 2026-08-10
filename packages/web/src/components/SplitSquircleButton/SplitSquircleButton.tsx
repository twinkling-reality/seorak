import type { CSSProperties, ReactNode } from 'react';
import styles from './SplitSquircleButton.module.css';

/**
 * Shared double-squircle button primitive.
 *
 * Anatomy: two visually separate rounded-rect segments — one square icon
 * segment and one wider label segment — with a 4px gutter. Both segments
 * share a height of 32px (`size="sm"`) or 46px (`size="md"`).
 *
 * Used by `DrillUpButton` (muted, icon-leading) and `SplitSquircleForward`
 * (accent, icon-trailing). Prefer those named presets at call sites; reach
 * for this primitive only when a new double-squircle control is needed.
 */
export type SplitSquircleTone = 'muted' | 'accent' | 'danger';
export type SplitSquircleIconPosition = 'leading' | 'trailing';
export type SplitSquircleSize = 'sm' | 'md';

interface Props {
  label: string;
  icon: ReactNode;
  iconPosition: SplitSquircleIconPosition;
  tone: SplitSquircleTone;
  /** Accent background color (CSS value, incl. `var(...)`). Only consulted when `tone="accent"`. */
  accentColor?: string;
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  /** `sm` = 32px inline/nav; `md` = 46px, matches form controls. */
  size?: SplitSquircleSize;
  /** Stretch full width; label segment grows to fill. */
  block?: boolean;
  ariaExpanded?: boolean;
}

export default function SplitSquircleButton({
  label,
  icon,
  iconPosition,
  tone,
  accentColor,
  onClick,
  ariaLabel,
  disabled = false,
  size = 'sm',
  block = false,
  ariaExpanded,
}: Props) {
  const rootStyle: CSSProperties | undefined =
    tone === 'accent' && accentColor
      ? ({ ['--split-squircle-accent' as string]: accentColor } as CSSProperties)
      : undefined;

  const iconEl = (
    <span className={styles.icon} aria-hidden="true">
      {icon}
    </span>
  );
  const labelEl = <span className={styles.label}>{label}</span>;

  const toneClass =
    tone === 'accent' ? styles.accent : tone === 'danger' ? styles.danger : styles.muted;
  const sizeClass = size === 'md' ? styles.sizeMd : '';
  const blockClass = block ? styles.block : '';

  return (
    <button
      type="button"
      className={`${styles.root} ${toneClass} ${sizeClass} ${blockClass}`.trim()}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      style={rootStyle}
      disabled={disabled}
    >
      {iconPosition === 'leading' ? iconEl : labelEl}
      {iconPosition === 'leading' ? labelEl : iconEl}
    </button>
  );
}
