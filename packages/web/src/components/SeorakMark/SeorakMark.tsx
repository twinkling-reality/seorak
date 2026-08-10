import { useId, type ReactNode } from 'react';

/**
 * SeorakMark — the seorak mountain mark (two peaks + a summit chevron), rendered
 * without a tile background so it sits cleanly on any surface. Filled with a
 * left-to-right `currentColor` gradient so
 * it inherits the surrounding ink (dark mark on light, light mark on dark) and
 * keeps the metallic depth. Single source for the brand mark across the app.
 *
 * Rendered as ONE gradient-filled rect clipped to the silhouette via a mask
 * (same technique as favicon.svg) rather than three separately-filled paths.
 * This matters: the two peaks cross in the center valley, so painting them as
 * three translucent paths double-darkened the overlap into a visible seam and
 * gave each piece its own objectBoundingBox gradient. The mask flattens the
 * silhouette to a single layer, so one continuous gradient runs across the whole
 * mark with no seam.
 *
 * The def ids are namespaced per instance via `useId` so multiple marks on one
 * page can't collide on shared SVG def ids.
 */
export function SeorakMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}): ReactNode {
  const uid = useId();
  const grad = `${uid}-grad`;
  const mask = `${uid}-mask`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
        <mask id={mask}>
          <path
            d="M12 76L35.5 36L54 58L46 76H12ZM26.5 68H40L44 60L35.5 49L26.5 68Z"
            fill="white"
            fillRule="evenodd"
            clipRule="evenodd"
          />
          <path
            d="M88 76L64.5 36L46 58L54 76H88ZM73.5 68H60L56 60L64.5 49L73.5 68Z"
            fill="white"
            fillRule="evenodd"
            clipRule="evenodd"
          />
          <path d="M50 18L61.5 34H56.5L50 26L43.5 34H38.5L50 18Z" fill="white" />
        </mask>
      </defs>
      <rect width="100" height="100" fill={`url(#${grad})`} mask={`url(#${mask})`} />
    </svg>
  );
}
