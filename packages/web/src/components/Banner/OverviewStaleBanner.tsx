import { forceRefresh } from '../../lib/stores/polling.js';
import FloatingBanner from './FloatingBanner.js';

export default function OverviewStaleBanner({
  visible,
}: {
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <FloatingBanner
      variant="info"
      eyebrow="Reconnecting"
      actions={[{ label: 'Retry', onClick: forceRefresh }]}
    >
      Showing the last loaded snapshot — the latest refresh didn’t land.
    </FloatingBanner>
  );
}
