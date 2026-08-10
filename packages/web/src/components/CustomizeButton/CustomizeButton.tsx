import clsx from 'clsx';
import styles from './CustomizeButton.module.css';
import glass from '../surface/glass.module.css';
import glassTrigger from '../controls/glassTrigger.module.css';
import kbdChip from '../controls/kbdChip.module.css';
import supCount from '../controls/supCount.module.css';

interface Props {
  active?: boolean;
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
  count?: number | string;
  /**
   * Optional keyboard shortcut to surface as a small kbd badge inside the
   * button. Persistent across the active state so the button doesn't shift
   * when toggled and so the shortcut stays discoverable while the user is
   * mid-flow. The shortcut is expected to act as a toggle (open AND close)
   * rather than open-only.
   */
  kbd?: string;
}

export default function CustomizeButton({
  active = false,
  onClick,
  label = 'Customize',
  ariaLabel,
  count,
  kbd,
}: Props) {
  return (
    <button
      type="button"
      className={clsx(
        glassTrigger.glassTrigger,
        styles.customizeBtn,
        glass.sheet,
        glass.rim,
        active && glassTrigger.glassTriggerActive,
        active && styles.customizeBtnActive,
      )}
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
    >
      <span className={styles.label}>
        {label}
        {count != null && <sup className={clsx(supCount.supCount, styles.count)}>{count}</sup>}
      </span>
      {kbd && <kbd className={kbdChip.kbdSm}>{kbd}</kbd>}
    </button>
  );
}
