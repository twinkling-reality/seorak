import { createContext, useContext, useId, type ComponentType, type ReactNode } from 'react';

/**
 * The brand slot: everything about this dashboard that names or depicts whoever
 * ships it, resolved in one place.
 *
 * WHY THIS EXISTS. Apache-2.0 section 6 grants no trademark rights, so the
 * licence that lets someone fork this dashboard is exactly the licence that does
 * not let them keep Seorak's mark on it. A prohibition with no mechanism leaves a
 * fork two bad options: infringe, or hunt down every logo and legal line by hand.
 * This slot is the mechanism. The DEFAULT is neutral, so a fork that deletes one
 * provider line has a working, non-infringing dashboard; Seorak's own build opts
 * back in by providing `seorakBrand` at its entry.
 *
 * It is not only a licensing device. `LegalFooter` used to hardcode links to
 * `/privacy`, `/terms`, and `/subprocessors`, which exist on Seorak's marketing
 * site and nowhere else. A dashboard served from a developer's own machine
 * rendered three links that answered 404. A brand with no legal links renders no
 * legal links, which is the honest result for a local build.
 */

export interface BrandLegalLink {
  readonly label: string;
  readonly href: string;
}

export interface BrandMarkProps {
  size?: number;
  className?: string;
}

export interface Brand {
  /** Product name, as chrome and accessible labels say it. */
  readonly name: string;
  /** The wordless mark. Square, `currentColor`, no background tile. */
  readonly Mark: ComponentType<BrandMarkProps>;
  /** Copyright line, or null when this build claims none. */
  readonly owner: string | null;
  /** Legal pages this build actually serves. Empty means it serves none. */
  readonly legal: readonly BrandLegalLink[];
}

/**
 * A wordless placeholder mark: a rounded square with a rising two-step, drawn in
 * `currentColor` at the same 100x100 viewBox and stroke weight the real marks
 * use, so swapping brands does not move any layout.
 *
 * Deliberately generic. It is a placeholder, not a second logo, and nothing in
 * this repository should grow attached to it.
 */
export function NeutralMark({ size = 40, className }: BrandMarkProps): ReactNode {
  const uid = useId();
  const clip = `${uid}-clip`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="14" y="14" width="72" height="72" rx="18" />
        </clipPath>
      </defs>
      <rect
        x="14"
        y="14"
        width="72"
        height="72"
        rx="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        opacity="0.55"
      />
      <g clipPath={`url(#${clip})`}>
        <path
          d="M26 66L44 66L44 50L62 50L62 34L80 34"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="square"
        />
      </g>
    </svg>
  );
}

/**
 * What an unbranded build is. A fork inherits this by doing nothing at all,
 * which is the point: the non-infringing path is the path of least effort.
 */
export const neutralBrand: Brand = {
  name: 'Dashboard',
  Mark: NeutralMark,
  owner: null,
  legal: [],
};

const BrandContext = createContext<Brand>(neutralBrand);

/** The brand this build ships. Neutral unless an entry provided otherwise. */
export function useBrand(): Brand {
  return useContext(BrandContext);
}

/**
 * Provide a brand for everything below. Entries do this once; nothing else
 * should, because two providers in one tree is how a chrome logo and a footer
 * end up disagreeing about whose product this is.
 */
export function BrandProvider({
  brand,
  children,
}: {
  brand: Brand;
  children: ReactNode;
}): ReactNode {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/** The current brand's mark, for the call sites that only need the glyph. */
export function BrandMark({ size, className }: BrandMarkProps): ReactNode {
  const { Mark } = useBrand();
  return <Mark size={size} className={className} />;
}
