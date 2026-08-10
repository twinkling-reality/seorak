import { describe, expect, it } from 'vitest';
import { marketingRouteKey } from './routeKeys.js';

/**
 * The route key decides what REMOUNTS, and a remount runs `routeEnter`, which
 * fades the page in from opacity 0. Getting this wrong is not a subtle layout
 * bug: it is a flash in the reader's face on every click.
 */
describe('marketingRouteKey', () => {
  it('keeps one key for the whole developer reference so a read swaps in place', () => {
    const overview = marketingRouteKey('docs-api', '/docs/api');
    for (const [page, path] of [
      ['docs-api', '/docs/api'],
      ['docs-api-read', '/docs/api/search'],
      ['docs-api-read', '/docs/api/profile'],
      ['docs-mcp', '/docs/mcp'],
      ['docs-mcp-read', '/docs/mcp/get_public_profile'],
    ] as const) {
      expect(marketingRouteKey(page, path), `${page} ${path}`).toBe(overview);
    }
  });

  it('still remounts on the way into and out of the reference', () => {
    const docs = marketingRouteKey('docs-api', '/docs/api');
    expect(marketingRouteKey('pricing', '/pricing')).not.toBe(docs);
    expect(marketingRouteKey('developers', '/developers')).not.toBe(docs);
  });

  it('keys the pages that genuinely swap their whole content by path', () => {
    expect(marketingRouteKey('blog-post', '/blog/a')).not.toBe(
      marketingRouteKey('blog-post', '/blog/b'),
    );
    expect(marketingRouteKey('surfaces', '/surfaces/web')).not.toBe(
      marketingRouteKey('surfaces', '/surfaces/mobile'),
    );
  });

  it('ignores a trailing slash so one address is not two keys', () => {
    expect(marketingRouteKey('blog-post', '/blog/a/')).toBe(
      marketingRouteKey('blog-post', '/blog/a'),
    );
  });
});
