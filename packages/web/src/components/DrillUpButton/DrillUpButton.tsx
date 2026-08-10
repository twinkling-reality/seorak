import SplitSquircleButton from '../SplitSquircleButton/SplitSquircleButton.js';

interface Props {
  label: string;
  onClick: () => void;
}

/** Muted double-squircle drill-up control (← + destination label). */
export default function DrillUpButton({ label, onClick }: Props) {
  return (
    <SplitSquircleButton
      label={label}
      icon={'\u2190'}
      iconPosition="leading"
      tone="muted"
      onClick={onClick}
      ariaLabel={`Back to ${label}`}
    />
  );
}
