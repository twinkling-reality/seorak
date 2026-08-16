/**
 * buildPlugins.test.ts — the CSP the build writes, checked against both entry
 * documents.
 *
 * This replaces a test that read the committed `public/_headers` and recomputed
 * the hash from `index.html`, so that editing the theme script failed until
 * somebody updated the header by hand. That test was right about the failure and
 * wrong about the fix: a hand-maintained hash CAN go stale, and when it does
 * nothing fails at build time. The page first-paints unstyled in a browser and
 * the only evidence is a console violation. The hash is derived from the emitted
 * document now, so the class of bug is gone rather than caught, and what is left
 * to test is the derivation and the policy it writes.
 *
 * The load-bearing assertion is the last one: the two entries hash to DIFFERENT
 * values. The old header's own comment asserted "Seorak is ONE single-page app",
 * which is the assumption the entry split breaks.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_PLANE_PROTOCOL_VERSION } from '@seorak/types/data-plane';
import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_MANIFEST_FILE,
  dataPlaneProtocol,
  headersFile,
  inlineScripts,
} from './buildPlugins.js';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * THE SITE ENTRY IS PRIVATE. B4 split one document into two and the ownership
 * map keeps `site/index.html` and `vite.site.config.ts` on the closed side:
 * they are Seorak's own website, carrying the canonical link and the social
 * cards. So in the public core there is one entry, and the cases below that
 * compare the two are comparing something this tree does not have.
 *
 * They are SKIPPED rather than deleted, because the property they assert is
 * real wherever both entries exist, and that is the repository where an edit
 * can break it. Everything above is per-entry and runs on whichever entries are
 * here.
 */
const SITE_ENTRY = resolve(WEB_ROOT, 'site/index.html');
const SITE_CONFIG = resolve(WEB_ROOT, 'vite.site.config.ts');
const SITE_PRESENT = existsSync(SITE_ENTRY) && existsSync(SITE_CONFIG);

const ENTRIES = {
  dashboard: readFileSync(resolve(WEB_ROOT, 'dashboard/index.html'), 'utf8'),
  ...(SITE_PRESENT ? { site: readFileSync(SITE_ENTRY, 'utf8') } : {}),
} as const;

function hashesFor(html: string): string[] {
  return inlineScripts(html).map(
    (body) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`,
  );
}

describe.each(Object.entries(ENTRIES))('%s entry', (_name, html) => {
  const headers = headersFile(hashesFor(html));

  it('has exactly one inline script, the pre-paint theme resolver', () => {
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('data-theme');
  });

  it('allows that script by its hash and never by unsafe-inline', () => {
    expect(headers).toContain(hashesFor(html)[0]);
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('keeps connect-src same-origin only, with no cross-origin worker', () => {
    expect(headers).toMatch(/connect-src 'self'/);
    expect(headers).not.toMatch(/connect-src[^;]*https?:\/\//);
  });

  it('keeps image loads on the shipped origin or embedded data', () => {
    expect(headers).toMatch(/img-src 'self' data:/);
    expect(headers).not.toMatch(/img-src[^;]*https:/);
  });

  it('keeps styles and fonts first party', () => {
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(headers).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(headers).toMatch(/style-src 'self' 'unsafe-inline';/);
    expect(headers).toMatch(/font-src 'self' data:;/);
  });

  it('carries no chinmeister design-source leftover', () => {
    expect(headers).not.toMatch(/chinmeister/i);
  });

  // These three close the exfiltration channels that do NOT need script
  // execution, which is the gap a strong script-src leaves open. Without this a
  // later edit to the header line drops them silently, since nothing renders a
  // CSP failure in a passing build.
  it.each([
    ["form-action 'self'", 'stops a form posting the DOM to another origin'],
    ["base-uri 'self'", 'stops an injected <base> repointing every relative url'],
    ["object-src 'none'", 'stops plugin content becoming a script vector'],
  ])('sets %s, which %s', (directive) => {
    expect(headers).toContain(directive);
  });
});

// The enumerable HTML addresses carry `noindex` in a prerendered head. These
// cannot: `/@/<slug>` is unbounded, and openapi.json / llms*.txt / the generated
// .md reads are not HTML, so a meta tag in the body is just bytes. The header is
// the only channel a crawler reads for those responses.
describe('retired Directory headers', () => {
  const headers = headersFile(["'sha256-x'"]);

  it.each([
    '/@/*',
    '/openapi.json',
    '/llms.txt',
    '/llms-full.txt',
    '/docs/*',
    '/developers',
    '/blog/private-record-public-identity',
  ])('asks a crawler to drop %s', (path) => {
    const rule = headers.slice(headers.indexOf(`\n${path}\n`));
    expect(rule, path).toContain('X-Robots-Tag: noindex');
  });

  it('leaves the live site indexable', () => {
    // The catch-all must never carry noindex: that would deindex the whole site.
    const catchAll = headers.slice(headers.indexOf('/*'), headers.indexOf('# The public Directory'));
    expect(catchAll).not.toContain('X-Robots-Tag');
  });
});

describe('inlineScripts', () => {
  it('skips scripts a browser fetches rather than inlines', () => {
    expect(inlineScripts('<script src="/assets/app.js">ignored</script>')).toEqual([]);
  });

  it('skips data blocks, which is what build:discovery injects per route', () => {
    const html = '<script type="application/ld+json">{"@type":"Blog"}</script>';
    expect(inlineScripts(html)).toEqual([]);
  });

  it('keeps a module script that has a body', () => {
    expect(inlineScripts('<script type="module">go()</script>')).toEqual(['go()']);
  });
});

describe.skipIf(!SITE_PRESENT)('the two entries', () => {
  it('do not share a script hash, because they do not share a script', () => {
    const [dashboard] = hashesFor(ENTRIES.dashboard);
    const [site] = hashesFor(ENTRIES.site);
    expect(dashboard).not.toBe(site);
  });

  it('differ because only the site has two halves to choose between', () => {
    // The site's resolver classifies the path first; the dashboard's cannot,
    // because every path this document answers is the dashboard.
    expect(inlineScripts(ENTRIES.site)[0]).toContain('/dashboard');
    expect(inlineScripts(ENTRIES.dashboard)[0]).not.toContain('/dashboard');
  });
});

describe('the data-plane protocol manifest', () => {
  it('is declared by the dashboard entry alone', () => {
    // The site entry is Seorak's website. Nothing resolves a protocol version
    // from it, and declaring one there would invite a consumer to.
    const config = readFileSync(resolve(WEB_ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toContain('dataPlaneProtocol()');
    if (!SITE_PRESENT) return;
    expect(readFileSync(SITE_CONFIG, 'utf8')).not.toContain('dataPlaneProtocol');
  });

  it('names the file the collector reads', () => {
    // One name, in one place. A plane looking for a differently spelled file
    // finds nothing and refuses a bundle that is perfectly good.
    expect(PROTOCOL_MANIFEST_FILE).toBe('data-plane-protocol.json');
    const plane = readFileSync(
      resolve(WEB_ROOT, '../collector/src/local-plane.ts'),
      'utf8',
    );
    expect(plane).toContain(`"${PROTOCOL_MANIFEST_FILE}"`);
  });

  it('writes the version the shared types hold, not a copy of it', async () => {
    // Driven rather than read: the plugin's own hooks, against a real directory,
    // so what is asserted is the file a consumer will find. The expected value
    // comes from @seorak/types, which is the plugin's own source, so there is no
    // second number here to keep in step with anything.
    const outDir = mkdtempSync(join(tmpdir(), 'seorak-protocol-'));
    try {
      const plugin = dataPlaneProtocol();
      (plugin.configResolved as (config: unknown) => void)({
        root: outDir,
        build: { outDir },
      });
      await (plugin.writeBundle as () => Promise<void>)();
      const written = JSON.parse(
        readFileSync(join(outDir, PROTOCOL_MANIFEST_FILE), 'utf8'),
      );
      expect(written.dataPlaneProtocolVersion).toBe(DATA_PLANE_PROTOCOL_VERSION);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
