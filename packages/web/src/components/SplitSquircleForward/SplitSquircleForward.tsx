import SplitSquircleButton, { type SplitSquircleSize } from '../SplitSquircleButton/SplitSquircleButton.js';

interface Props {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: SplitSquircleSize;
  block?: boolean;
}

/** Accent double-squircle forward control (label + →). */
export default function SplitSquircleForward({
  label = 'Launch',
  onClick,
  disabled = false,
  ariaLabel,
  size = 'sm',
  block = false,
}: Props) {
  return (
    <SplitSquircleButton
      label={label}
      icon={'\u2192'}
      iconPosition="trailing"
      tone="accent"
      accentColor="var(--report-color, var(--ink))"
      onClick={onClick}
      ariaLabel={ariaLabel ?? label}
      disabled={disabled}
      size={size}
      block={block}
    />
  );
}
