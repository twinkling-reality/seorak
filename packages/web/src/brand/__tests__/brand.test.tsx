// @vitest-environment jsdom
/**
 * brand.test.tsx — the fork's non-infringing path, asserted rather than
 * described.
 *
 * The failure that matters is not "the context broke". It is a fork that removes
 * the provider and still ships Seorak's mark, or a locally-served dashboard that
 * renders links to legal pages only Seorak's marketing site serves. Both are
 * properties of the DEFAULT, so the default is what these tests pin.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandMark, BrandProvider, neutralBrand, type Brand } from '../brand.js';
import { seorakBrand } from '../seorakBrand.js';
import { LegalFooter } from '../../components/LegalFooter/LegalFooter.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return host;
}

afterEach(() => {
  host?.remove();
  host = null;
});

describe('the neutral default', () => {
  it('is what a tree with no provider gets', () => {
    // Not a styling detail: this is the whole mechanism. A fork that deletes the
    // one `brand={seorakBrand}` on its entry lands here.
    const el = render(<BrandMark size={32} />);
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('svg')?.getAttribute('width')).toBe('32');
    // Seorak's mark paints one masked rect; the neutral one does not.
    expect(el.querySelector('mask')).toBeNull();
  });

  it('claims no owner and links to no legal pages', () => {
    expect(neutralBrand.owner).toBeNull();
    expect(neutralBrand.legal).toHaveLength(0);
  });

  it('renders no legal footer at all rather than an empty bar', () => {
    const el = render(<LegalFooter />);
    expect(el.textContent).toBe('');
    expect(el.querySelector('nav')).toBeNull();
  });
});

describe('a provided brand', () => {
  it('replaces the mark everywhere below it', () => {
    const marker = 'data-test-mark';
    const forkBrand: Brand = {
      name: 'Fork',
      Mark: ({ size }) => <svg {...{ [marker]: '' }} width={size} height={size} />,
      owner: '(c) 2026 Someone Else',
      legal: [{ label: 'Notice', href: '/notice' }],
    };
    const el = render(
      <BrandProvider brand={forkBrand}>
        <BrandMark size={18} />
        <LegalFooter />
      </BrandProvider>,
    );
    expect(el.querySelector(`svg[${marker}]`)).not.toBeNull();
    expect(el.textContent).toContain('(c) 2026 Someone Else');
    const links = [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/notice']);
  });

  it('carries Seorak s own legal pages only when Seorak s brand is provided', () => {
    const el = render(
      <BrandProvider brand={seorakBrand}>
        <LegalFooter />
      </BrandProvider>,
    );
    const links = [...el.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/privacy', '/terms', '/subprocessors']);
    expect(el.textContent).toContain('Twinkling Reality');
  });

  it('honours showOwner without dropping the links', () => {
    const el = render(
      <BrandProvider brand={seorakBrand}>
        <LegalFooter showOwner={false} />
      </BrandProvider>,
    );
    expect(el.textContent).not.toContain('Twinkling Reality');
    expect(el.querySelectorAll('nav a')).toHaveLength(3);
  });
});
