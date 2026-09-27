import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test } from "node:test";

import { scanBuffer, scanSourceBytes } from "./check-source-bytes.mjs";

const temporary = [];

afterEach(() => {
  while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "seorak-source-bytes-"));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

/** The exact defect: a composite key separated by a raw NUL. */
const NUL_SOURCE = Buffer.concat([
  Buffer.from("const key = `${a.agent}"),
  Buffer.from([0x00]),
  Buffer.from("${a.model}`;\n"),
]);

/** The same key written correctly. */
const ESCAPED_SOURCE = Buffer.from("const key = `${a.agent}\\0${a.model}`;\n");

test("a raw NUL is reported with its line", () => {
  const issues = scanBuffer(
    Buffer.concat([Buffer.from("first\nsecond\n"), NUL_SOURCE]),
  );
  assert.deepEqual(
    issues.map(({ line, name }) => [line, name]),
    [[3, "NUL"]],
  );
});

test("the escape form is not a control byte", () => {
  assert.deepEqual(scanBuffer(ESCAPED_SOURCE), []);
  // The two differ on disk and are identical at runtime, which is the whole
  // reason the byte form is never worth keeping.
  assert.notEqual(NUL_SOURCE.length, ESCAPED_SOURCE.length);
  assert.equal(`x\0y`, "x" + String.fromCharCode(0) + "y");
});

test("tab, newline, and carriage return stay legal", () => {
  assert.deepEqual(scanBuffer(Buffer.from("a\tb\r\nc\n")), []);
});

test("other C0 controls are caught, and every one is named", () => {
  const issues = scanBuffer(Buffer.from([0x0b, 0x0a, 0x0c, 0x0a, 0x1a]));
  assert.deepEqual(
    issues.map(({ line, name }) => [line, name]),
    [
      [1, "VT"],
      [2, "FF"],
      [3, "SUB"],
    ],
  );
});

test("scans text sources and reports the path", () => {
  const root = fixture({
    "packages/web/src/views/AgentsView/agentsScope.ts": NUL_SOURCE,
    "packages/worker/src/eventlog/rollupGrain.ts": NUL_SOURCE,
    "packages/collector/src/local-store.ts": ESCAPED_SOURCE,
  });

  assert.deepEqual(
    scanSourceBytes({ repoRoot: root }).map(({ path, name }) => [path, name]),
    [
      ["packages/web/src/views/AgentsView/agentsScope.ts", "NUL"],
      ["packages/worker/src/eventlog/rollupGrain.ts", "NUL"],
    ],
  );
});

test("a clean tree reports nothing", () => {
  const root = fixture({
    "packages/web/src/a.ts": ESCAPED_SOURCE,
    "docs/specs/pricing.md": "# Pricing\n\nPlain prose.\n",
    "scripts/check.mjs": "export const ok = true;\n",
  });
  assert.deepEqual(scanSourceBytes({ repoRoot: root }), []);
});

test("binary assets are excluded by extension, not by sniffing content", () => {
  const root = fixture({
    "packages/web/src/marketing/scene/assets/figure-v1.bin": Buffer.from([
      0x00, 0x01, 0x02,
    ]),
    "apps/mobile/assets/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x00]),
  });
  assert.deepEqual(scanSourceBytes({ repoRoot: root }), []);
});

test("falls back to a directory walk outside a git repository", () => {
  // The fixtures below are plain temp directories, not repos, so `git ls-files`
  // fails and the walk takes over. Pinning it means the fallback is a decision
  // rather than something the other tests exercise by accident.
  const root = fixture({ "packages/web/src/a.ts": NUL_SOURCE });
  assert.deepEqual(
    scanSourceBytes({ repoRoot: root }).map(({ path }) => path),
    ["packages/web/src/a.ts"],
  );
});

test("build output and dependencies are not scanned", () => {
  const root = fixture({
    "packages/web/node_modules/pkg/index.js": NUL_SOURCE,
    "packages/web/dist/bundle.js": NUL_SOURCE,
    "packages/control-plane/.wrangler/tmp/index.js": NUL_SOURCE,
    "packages/web/src/real.ts": NUL_SOURCE,
  });
  assert.deepEqual(
    scanSourceBytes({ repoRoot: root }).map(({ path }) => path),
    ["packages/web/src/real.ts"],
  );
});

test("a control-character range written as an escape stays legal", () => {
  // The form `@seorak/types` uses to reject control characters in ids. Writing
  // that range as literal bytes instead is the same defect wearing a regex,
  // and it is unreviewable for the same reason: the file stops being text.
  assert.deepEqual(scanBuffer(Buffer.from("!/[\\u0000-\\u001f]/.test(value)")), []);

  const literal = Buffer.concat([
    Buffer.from("!/["),
    Buffer.from([0x00]),
    Buffer.from("-"),
    Buffer.from([0x1f]),
    Buffer.from("]/.test(value)"),
  ]);
  // Both ends of the range are caught. A NUL-only rule would have reported the
  // first and waved the second through, which is how a raw `0x1f` survived in
  // ReplayStackPlayer until the range was completed.
  assert.deepEqual(
    scanBuffer(literal).map(({ name }) => name),
    ["NUL", "US"],
  );
});
