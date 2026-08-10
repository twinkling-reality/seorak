import { SeorakMark } from '../components/SeorakMark/SeorakMark.js';
import type { Brand } from './brand.js';

/**
 * Seorak's own brand, provided by Seorak's entries and by nothing else.
 *
 * This file being readable is not the same as it being usable: the mark, the
 * name, and the owner line are trademarks and a copyright claim, and Apache-2.0
 * section 6 licenses none of them. A fork removes the one `brand={seorakBrand}`
 * on its entry and falls back to `neutralBrand`, or supplies its own `Brand`.
 *
 * The legal links are the pages Seorak's marketing site serves. They are here
 * rather than in `LegalFooter` because a build that does not serve those pages
 * must not render links to them.
 */
export const seorakBrand: Brand = {
  name: 'Seorak',
  Mark: SeorakMark,
  owner: '© 2026 Twinkling Reality',
  legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Subprocessors', href: '/subprocessors' },
  ],
};
