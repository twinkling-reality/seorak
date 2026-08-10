// ── Mini SVG illustrations ────────────────────────
//
// The fallback specimen: what a widget's shape looks like when no body is
// registered or no snapshot has arrived. Abstract on purpose — it says "this is
// a bar chart", never "here is your data".

import type { WidgetViz } from '../catalog/index.js';

export function VizIllustration({ viz }: { viz: WidgetViz }) {
  const fill = 'var(--ghost)';
  const stroke = 'var(--soft)';
  switch (viz) {
    case 'stat':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="24" y="12" width="52" height="24" rx="4" fill={fill} />
        </svg>
      );
    case 'sparkline':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <path
            d="M8 38 Q20 8, 32 24 T56 16 T80 20 T92 12"
            stroke={stroke}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'bar-chart':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="12" y="24" width="12" height="20" rx="2" fill={fill} />
          <rect x="28" y="12" width="12" height="32" rx="2" fill={fill} />
          <rect x="44" y="18" width="12" height="26" rx="2" fill={fill} />
          <rect x="60" y="8" width="12" height="36" rx="2" fill={fill} />
          <rect x="76" y="22" width="12" height="22" rx="2" fill={fill} />
        </svg>
      );
    case 'heatmap':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3, 4].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={12 + c * 17}
                y={6 + r * 14}
                width="12"
                height="10"
                rx="2"
                fill={fill}
                opacity={0.3 + ((r * 5 + c) % 7) * 0.1}
              />
            )),
          )}
        </svg>
      );
    case 'data-list':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="8" y="8" width="84" height="7" rx="2" fill={fill} />
          <rect x="8" y="20" width="68" height="7" rx="2" fill={fill} />
          <rect x="8" y="32" width="76" height="7" rx="2" fill={fill} />
        </svg>
      );
    case 'live-list':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <circle cx="14" cy="24" r="3" fill={fill} />
          <rect x="22" y="21" width="24" height="6" rx="2" fill={fill} />
          <circle cx="58" cy="24" r="3" fill={fill} />
          <rect x="66" y="21" width="20" height="6" rx="2" fill={fill} />
        </svg>
      );
    case 'ring':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <circle cx="50" cy="24" r="14" stroke={fill} strokeWidth="4" fill="none" />
          <path d="M50 10 A14 14 0 0 1 64 24" stroke={stroke} strokeWidth="4" fill="none" />
        </svg>
      );
    default:
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="16" y="8" width="68" height="32" rx="4" fill={fill} />
        </svg>
      );
  }
}
