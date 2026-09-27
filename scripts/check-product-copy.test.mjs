import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test } from "node:test";

import { scanProductCopy } from "./check-product-copy.mjs";

const temporary = [];

afterEach(() => {
  while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "seorak-copy-check-"));
  temporary.push(root);
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

test("finds forbidden product copy in TSX, templates, and CSS content", () => {
  const root = fixture({
    "packages/web/src/View.tsx":
      "export const View = () => <p>{`Signal · ${'now'}`}</p>;",
    "packages/web/src/view.css": ".meta::before { content: ' · '; }",
  });

  const issues = scanProductCopy({ repoRoot: root });
  assert.deepEqual(
    issues.map(({ path, kind }) => [path, kind]),
    [
      ["packages/web/src/view.css", "middot"],
      ["packages/web/src/View.tsx", "middot"],
      ["packages/web/src/View.tsx", "signal"],
    ],
  );
});

test("covers every shipped product surface by default", () => {
  const root = fixture({
    "packages/collector/src/terminal/view.ts": 'export const copy = "collector signal";',
    "packages/control-plane/src/html.ts": 'export const copy = "workspace signal";',
    "packages/worker/src/notification.ts": 'export const copy = "worker · notification";',
    "packages/push/src/dispatch.ts": 'export const copy = "push signal";',
    "packages/public-directory/src/page.ts": 'export const copy = "directory · page";',
    "apps/mobile/targets/widget/SeorakLiveActivity.swift": 'Text("lock · screen")',
    // Comment stripping, nested comments, interpolation and raw strings used to
    // be exercised on an `apps/menubar` path. That surface was removed on
    // 2026-08-10, so the same cases moved to the Swift root that remains rather
    // than being deleted with it.
    "apps/mobile/targets/widget/SeorakPanel.swift": `
      // Text("comment signal ·")
      /* Text("nested comment signal /* · */") */
      Text("panel signal \\(count)")
      Text(#"panel · value"#)
    `,
  });

  const issues = scanProductCopy({ repoRoot: root });
  assert.deepEqual(
    issues.map(({ path, kind }) => [path, kind]),
    [
      ["apps/mobile/targets/widget/SeorakLiveActivity.swift", "middot"],
      ["apps/mobile/targets/widget/SeorakPanel.swift", "signal"],
      ["apps/mobile/targets/widget/SeorakPanel.swift", "middot"],
      ["packages/collector/src/terminal/view.ts", "signal"],
      ["packages/control-plane/src/html.ts", "signal"],
      ["packages/public-directory/src/page.ts", "middot"],
      ["packages/push/src/dispatch.ts", "signal"],
      ["packages/worker/src/notification.ts", "middot"],
    ],
  );
});

test("allows internal syntax, the one title composer, and the static route table", () => {
  const root = fixture({
    "packages/web/src/internal.ts": `
      import post from "./signals-not-content.js";
      type Request = { signal?: AbortSignal; settings: NotificationSettings["signals"] };
      const settings = { id: "signals-not-content", slug: "signals-not-content", key: "signal" };
      void post; void settings;
    `,
    "packages/web/src/marketing/routes/routeModel.ts": `
      export const META = { home: { title: "Home · Seorak", description: "Derived stats." } };
    `,
    "packages/web/src/marketing/paths.ts": `
      export const SITE_NAME = 'Seorak';
      export function documentTitle(pageTitle) { return \`\${pageTitle} · \${SITE_NAME}\`; }
    `,
  });

  assert.deepEqual(scanProductCopy({ repoRoot: root }), []);
});

test("still flags a page that composes its own document title", () => {
  const root = fixture({
    // Both shapes the old per-file allowlist used to permit. Neither is the
    // composer, so both are the drift this gate exists to catch.
    "packages/web/src/marketing/blog/BlogPostPage.tsx": `
      const title = \`Post · Seorak\`;
      document.title = "Missing · Seorak";
    `,
    // The composer's own file holds one exemption, not a blanket one.
    "packages/web/src/marketing/paths.ts": `
      export const breadcrumb = 'Directory · Seorak';
    `,
  });

  assert.deepEqual(
    scanProductCopy({ repoRoot: root }).map(({ path, kind }) => [path, kind]),
    [
      ["packages/web/src/marketing/blog/BlogPostPage.tsx", "middot"],
      ["packages/web/src/marketing/blog/BlogPostPage.tsx", "middot"],
      ["packages/web/src/marketing/paths.ts", "middot"],
    ],
  );
});

test("flags the em dash and its double-hyphen stand-in in pricing copy", () => {
  const root = fixture({
    "packages/web/src/marketing/pages/pricing/PricingPage.tsx": `
      export const hero = () => <p>Every feature is free — Pro is operated.</p>;
      export const note = "Run it yourself -- or let Seorak run it.";
      export const cadence = "monthly--annual";
    `,
    "packages/web/src/marketing/pages/pricing/PricingPage.module.css":
      ".plan { color: var(--marketing-ink); } .plan::after { content: ' — '; }",
    "packages/control-plane/src/billingHtml.ts":
      'export const status = "Pro activates after a verified webhook — not after checkout.";',
  });

  assert.deepEqual(
    scanProductCopy({ repoRoot: root }).map(({ path, kind }) => [path, kind]),
    [
      ["packages/control-plane/src/billingHtml.ts", "em-dash"],
      ["packages/web/src/marketing/pages/pricing/PricingPage.module.css", "em-dash"],
      ["packages/web/src/marketing/pages/pricing/PricingPage.tsx", "em-dash"],
      ["packages/web/src/marketing/pages/pricing/PricingPage.tsx", "em-dash"],
      ["packages/web/src/marketing/pages/pricing/PricingPage.tsx", "em-dash"],
    ],
  );
});

test("holds the em-dash rule on field journal prose", () => {
  const root = fixture({
    "packages/web/src/marketing/blog/posts/the-stall.ts":
      'export const post = "A stall is not a crash — it is a session going nowhere.";',
    "packages/web/src/marketing/content/mission.ts":
      'export const body = "The record is yours — read it however you like.";',
  });

  assert.deepEqual(
    scanProductCopy({ repoRoot: root }).map(({ path, kind }) => [path, kind]),
    [
      ["packages/web/src/marketing/blog/posts/the-stall.ts", "em-dash"],
      ["packages/web/src/marketing/content/mission.ts", "em-dash"],
    ],
  );
});

test("holds the em dash character on every scanned surface", () => {
  const root = fixture({
    "packages/control-plane/src/html.ts":
      'export const copy = "Signed in — welcome back.";',
    "packages/collector/src/status.ts": "export const line = `✓ hooks — 6/6 bound`;",
    "packages/push/src/body.ts":
      'export const body = "Your agent has been retrying — 25 minutes.";',
    "packages/public-directory/src/page.ts":
      'export const empty = "No published projects — yet.";',
    "apps/mobile/targets/widget/SeorakPanel.swift": 'Text("Working — 12m")',
    "packages/web/src/view.css": ".plan::after { content: ' — '; }",
  });

  assert.deepEqual(
    scanProductCopy({ repoRoot: root }).map(({ path, kind }) => [path, kind]),
    [
      ["apps/mobile/targets/widget/SeorakPanel.swift", "em-dash"],
      ["packages/collector/src/status.ts", "em-dash"],
      ["packages/control-plane/src/html.ts", "em-dash"],
      ["packages/public-directory/src/page.ts", "em-dash"],
      ["packages/push/src/body.ts", "em-dash"],
      ["packages/web/src/view.css", "em-dash"],
    ],
  );
});

test("keeps the double-hyphen stand-in to prose, where it is knowable", () => {
  const root = fixture({
    // Outside the prose surfaces the same characters are a BEM modifier or a
    // SQLite comment inside a DDL template, which are code and not copy at all.
    "packages/web/src/views/OverviewView/OverviewView.tsx":
      'export const empty = "Nothing yet -- your next session shows up here.";',
    "packages/worker/src/notification.ts": 'export const copy = "retry--loop";',
    "packages/control-plane/src/htmlShell.ts":
      'export const shell = `<main class="entry-main entry-main--task"></main>`;',
    "packages/collector/src/local-store.ts":
      "export const schema = `CREATE TABLE local_event (\n  -- one row per captured event\n  local_seq INTEGER PRIMARY KEY\n);`;",
    // Inside pricing copy, a CSS custom property and a CLI long flag are not
    // an em-dash stand-in and must stay legal.
    "packages/web/src/marketing/pages/pricing/CopyCommand.tsx":
      'export const install = "npm i -g @seorak/collector"; export const purge = "seorak uninstall --purge"; export const token = "var(--marketing-ink)";',
  });

  assert.deepEqual(scanProductCopy({ repoRoot: root }), []);
});

test("leaves a GLSL source alone, its own comments included", () => {
  const root = fixture({
    "packages/web/src/marketing/IridescentSquircle.tsx": `
      const FRAG = \`
      // Soft gaussian bloom around an animated centre — the building block.
      void main() {}
      \`;
      void FRAG;
    `,
    "packages/web/src/marketing/scene/HeroFigure.tsx": `
      const VERT = \`
      // Ashima/McEwan 3D simplex noise — WebGL1 safe (no dynamic loops).
      void main() {}
      \`;
      void VERT;
    `,
  });

  assert.deepEqual(scanProductCopy({ repoRoot: root }), []);
});

test("still flags ordinary copy in a module that also holds a shader", () => {
  // The exemption is by declaration, so it never spreads to the whole file.
  const root = fixture({
    "packages/web/src/marketing/IridescentSquircle.tsx":
      'export const caption = "A squircle — iridescent.";',
  });

  assert.deepEqual(
    scanProductCopy({ repoRoot: root }).map(({ path, kind }) => [path, kind]),
    [["packages/web/src/marketing/IridescentSquircle.tsx", "em-dash"]],
  );
});

test("does not blanket-exempt marketing, titles, or arbitrary dev files", () => {
  const root = fixture({
    "packages/web/src/marketing/pages/OrdinaryPage.tsx":
      'export const Ordinary = () => <p title="Signal · now">Signal · now</p>;',
    "packages/web/src/OtherPage.tsx":
      'document.title = "Other · Seorak"; export const copy = "signal";',
    "packages/web/src/dev/Preview.tsx": 'export const preview = "signal · preview";',
  });

  const issues = scanProductCopy({ repoRoot: root });
  assert.equal(issues.filter((issue) => issue.kind === "signal").length, 4);
  assert.equal(issues.filter((issue) => issue.kind === "middot").length, 4);
});
