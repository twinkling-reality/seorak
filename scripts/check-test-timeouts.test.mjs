/**
 * The test timeout policy's own suite.
 *
 * Every case below is built against a synthetic workspace tree in a temp
 * directory rather than against the real repository, for the reason the gate's
 * docblock gives: the interesting inputs are the BROKEN ones, and the real tree
 * can only ever show one state at a time.
 *
 * THERE IS DELIBERATELY NO "the real repository passes" ASSERTION HERE, and its
 * removal is not a gap. `test-timeouts:check` makes exactly that claim two links
 * later in the same `&&` chain, with a formatted `! …` list. Asserting it here
 * as well bought nothing and cost two things: a policy failure printed a
 * deepStrictEqual dump and a ten-frame stack instead of the readable lines the
 * gate formats, which is the regression commit ee616591 was spent on; and it
 * failed FIFTH in the root chain, making all 53 later gates unreachable for a
 * finding the chain reports on its own a moment later.
 *
 * Nothing here spawns git, so `scripts/isolated-git.mjs` is not needed: the gate
 * reads manifests and config sources off disk and nothing else.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  CONFIG_CANDIDATES,
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  REQUIRED_KEYS,
  TIMEOUT_CEILING_MS,
  TIMEOUT_FLOOR_MS,
  TestTimeoutPolicyError,
  UNRESOLVABLE_FLAGS,
  analyzeScript,
  assertTestTimeouts,
  checkTestTimeouts,
  commandSegments,
  declaredWorkspaceGlobs,
  expandWorkspaceGlob,
  findTestBlock,
  findTimeoutOverrides,
  formatEvidence,
  globToRegExp,
  integerConstants,
  invokesVitest,
  maskSource,
  matchDelimiter,
  readDeclaredRoot,
  readDeclaredStringArray,
  readDeclaredTimeout,
  resolveConfigPath,
  testFilesIn,
  topLevelArguments,
  vitestWorkspaces,
  workspaceDirectories,
} from "./check-test-timeouts.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const scratch = [];

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/**
 * A repository-shaped scratch tree. `files` maps a repo-relative path to its
 * contents. A root manifest declaring `packages/*` is written unless the fixture
 * supplies its own, because the gate derives its scan from `workspaces` and a
 * tree without one is not a repository.
 */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "seorak-test-timeouts-"));
  scratch.push(root);
  const all = {
    ...(files["package.json"] === undefined
      ? { "package.json": { name: "fixture", private: true, workspaces: ["packages/*", "apps/*"] } }
      : {}),
    ...files,
  };
  for (const [path, contents] of Object.entries(all)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
    );
  }
  return root;
}

/** A config declaring both keys at `value`, inside the `test` block. */
function config(value, { omit = [] } = {}) {
  const entries = REQUIRED_KEYS.filter((key) => !omit.includes(key)).map(
    (key) => `    ${key}: ${value},`,
  );
  return [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    '    environment: "node",',
    ...entries,
    "  },",
    "});",
    "",
  ].join("\n");
}

/** A workspace manifest whose `test` script runs vitest. */
function manifest(name, script = "vitest run") {
  return { name, scripts: { test: script } };
}

describe("deciding which workspaces are in scope", () => {
  it("reads vitest out of every shape this repository uses", () => {
    for (const script of [
      "vitest run",
      "vitest run test",
      "vitest run --coverage",
      "node --test scripts/a.node-test.mjs && vitest run",
      "npx vitest run",
      "./node_modules/.bin/vitest run",
      "(vitest run)",
    ]) {
      assert.equal(invokesVitest(script), true, script);
    }
  });

  it("does not fire on something that merely contains the word", () => {
    for (const script of [
      'node --test "test/**/*.test.ts"',
      "tsc --noEmit -p tsconfig.json",
      "node scripts/patch-vitest.mjs",
      "echo novitest",
      "eslint --config vitest.config.ts .",
    ]) {
      assert.equal(invokesVitest(script), false, script);
    }
  });

  it("ignores a workspace whose scripts do not run vitest", () => {
    const root = tree({
      "packages/runner/package.json": manifest("@x/runner"),
      "packages/runner/vitest.config.ts": config(30_000),
      "packages/plain/package.json": {
        name: "@x/plain",
        scripts: { test: 'node --experimental-strip-types --test "test/**/*.test.ts"' },
      },
      "apps/native/package.json": { name: "native", scripts: { test: "swift test" } },
    });
    assert.deepEqual(
      vitestWorkspaces(root).workspaces.map((workspace) => workspace.name),
      ["@x/runner"],
    );
    assert.deepEqual(checkTestTimeouts(root).problems, []);
  });

  it("takes a workspace whose vitest run hides in a non-test script", () => {
    const root = tree({
      "packages/sideways/package.json": {
        name: "@x/sideways",
        scripts: { test: "node --test test/*.mjs", "test:unit": "vitest run" },
      },
    });
    const [workspace] = vitestWorkspaces(root).workspaces;
    assert.equal(workspace.name, "@x/sideways");
    assert.deepEqual(workspace.scripts, ["test:unit"]);
  });
});

describe("deriving the workspace roots from the root manifest", () => {
  it("reads workspaces rather than assuming packages and apps", () => {
    // The hard-coded ["packages", "apps"] this replaced made both of these
    // invisible: each runs vitest with no config and each was a silent pass.
    const tools = tree({
      "package.json": { name: "r", private: true, workspaces: ["packages/*", "tools/*"] },
      "tools/runner/package.json": manifest("@x/runner"),
    });
    const toolsProblems = checkTestTimeouts(tools).problems;
    assert.equal(toolsProblems.length, 1);
    assert.match(toolsProblems[0], /@x\/runner/);
    assert.match(toolsProblems[0], /tools\/runner\/vitest\.config\.ts/);

    const nested = tree({
      "package.json": { name: "r", private: true, workspaces: ["packages/*/*"] },
      "packages/group/sub/package.json": manifest("@x/sub"),
    });
    const nestedProblems = checkTestTimeouts(nested).problems;
    assert.equal(nestedProblems.length, 1);
    assert.match(nestedProblems[0], /packages\/group\/sub/);
  });

  it("expands the glob shapes npm accepts", () => {
    const root = tree({
      "package.json": { name: "r", private: true, workspaces: ["packages/*"] },
      "packages/a/package.json": manifest("@x/a"),
      "packages/a/vitest.config.ts": config(30_000),
      "packages/b/package.json": manifest("@x/b"),
      "packages/b/vitest.config.ts": config(30_000),
      "packages/b/deep/nested/package.json": manifest("@x/deep"),
      "tools/t/package.json": manifest("@x/t"),
    });
    assert.deepEqual(expandWorkspaceGlob(root, "packages/*"), ["packages/a", "packages/b"]);
    assert.ok(expandWorkspaceGlob(root, "packages/**").includes("packages/b/deep/nested"));
    assert.deepEqual(expandWorkspaceGlob(root, "tools/t"), ["tools/t"]);
    // tools/* is not declared, so tools/t is not scanned and @x/t is not a finding.
    assert.deepEqual(checkTestTimeouts(root).problems, []);
  });

  it("honours a negated pattern", () => {
    const root = tree({
      "package.json": { name: "r", private: true, workspaces: ["packages/*", "!packages/skipped"] },
      "packages/kept/package.json": manifest("@x/kept"),
      "packages/kept/vitest.config.ts": config(30_000),
      "packages/skipped/package.json": manifest("@x/skipped"),
    });
    assert.deepEqual(workspaceDirectories(root).directories, ["packages/kept"]);
    assert.deepEqual(checkTestTimeouts(root).problems, []);
  });

  it("reads both npm spellings, and fails loudly when neither is there", () => {
    assert.deepEqual(declaredWorkspaceGlobs({ workspaces: ["a/*"] }), ["a/*"]);
    assert.deepEqual(declaredWorkspaceGlobs({ workspaces: { packages: ["b/*"] } }), ["b/*"]);
    assert.equal(declaredWorkspaceGlobs({}), undefined);

    const root = tree({ "package.json": { name: "r", private: true } });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /declares no `workspaces`/);
  });
});

describe("resolving the config vitest would load", () => {
  it("prefers vitest.config.ts and falls back to vite.config.ts", () => {
    const both = tree({
      "packages/a/package.json": manifest("@x/a"),
      "packages/a/vite.config.ts": config(30_000),
      "packages/a/vitest.config.ts": config(30_000),
    });
    assert.equal(resolveConfigPath(both, "packages/a"), "packages/a/vitest.config.ts");

    const fallback = tree({
      "packages/a/package.json": manifest("@x/a"),
      "packages/a/vite.config.ts": config(30_000),
    });
    assert.equal(resolveConfigPath(fallback, "packages/a"), "packages/a/vite.config.ts");
    assert.deepEqual(checkTestTimeouts(fallback).problems, []);
  });

  it("fails a workspace that runs vitest with no config at all", () => {
    const root = tree({ "packages/bare/package.json": manifest("@x/bare") });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /@x\/bare/);
    assert.match(problems[0], /no config file/);
    assert.match(problems[0], /5000ms/);
    assert.match(problems[0], new RegExp(CONFIG_CANDIDATES[0].replaceAll(".", "\\.")));
  });
});

describe("masking the source before reading it", () => {
  it("keeps the length and the line count, so indices stay honest", () => {
    const source = "/* a */\nconst x = 1; // b\n";
    const { masked } = maskSource(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.split("\n").length, source.split("\n").length);
    assert.match(masked, /const x = 1;/);
  });

  it("survives a regex containing a quote, which used to desync the lexer", () => {
    // PROVEN FALSE PASS before regex support: the `'` inside the character class
    // opened a string state, the following line comments were not blanked, and
    // a commented-out declaration was read as live.
    const source = [
      "const re = /[^']/;",
      "// testTimeout: 30000",
      "// hookTimeout: 30000",
      'export default { test: { environment: "node" } };',
    ].join("\n");
    assert.deepEqual(readDeclaredTimeout(source, "testTimeout"), {
      error: "testTimeout is not declared",
    });
  });

  it("does not read a regex ending in a slash pair as a comment", () => {
    // The other direction, and it was a false FAIL: /^https:\/\// is ordinary in
    // a vite proxy config, and the old rule ate the rest of the line.
    const source = [
      "const proxied = /^https:\\/\\//;",
      "export default { test: { testTimeout: 60000, proxied } };",
    ].join("\n");
    assert.deepEqual(readDeclaredTimeout(source, "testTimeout"), { value: 60_000 });
  });

  it("tells a division from a regex start", () => {
    const source = [
      "const half = total / 2;",
      "const rest = items[0] / count;",
      "export default { test: { testTimeout: 60000 } };",
    ].join("\n");
    assert.deepEqual(readDeclaredTimeout(source, "testTimeout"), { value: 60_000 });
  });

  it("blanks a string body but keeps a quoted property key", () => {
    assert.deepEqual(
      readDeclaredTimeout('export default { test: { "testTimeout": 30000 } };', "testTimeout"),
      { value: 30_000 },
    );
    // PROVEN FALSE PASS: the key inside a string literal is not a declaration.
    const inString = [
      `const doc = '{"testTimeout": 30000}';`,
      'export default { test: { environment: "node", doc } };',
    ].join("\n");
    assert.match(readDeclaredTimeout(inString, "testTimeout").error, /not declared/);
  });

  it("reports a lexer that lost sync instead of guessing", () => {
    for (const [source, pattern] of [
      ['const a = "open;\nexport default { test: {} };', /unterminated string/],
      ["/* never closed\nexport default { test: {} };", /unterminated block comment/],
      ["const t = `open;\nexport default { test: {} };", /unterminated template/],
    ]) {
      assert.match(readDeclaredTimeout(source, "testTimeout").error, pattern, source);
    }
  });

  it("does not read a JSX closing tag as a regular expression", () => {
    // ELEVEN PROVEN FAILURES ON CORRECT INPUT. `</div>` puts a `/` after a `<`,
    // which the previous-token heuristic read as a regex start; with no second
    // `/` before the newline the masker reported a lexer desync, and under this
    // gate's own rule that is a hard failure on a file vitest runs happily.
    for (const source of [
      "render(<div>hello</div>);",
      "const El = () => <nav aria-label=\"x\">y</nav>;",
      "act(() => root.render(<div>{node}</div>));",
    ]) {
      assert.equal(maskSource(source).error, undefined, source);
    }
    // The other direction still holds: `!` as logical not may precede a regex.
    assert.equal(maskSource("if (!/x/.test(s)) { }").masked, "if (!   .test(s)) { }");
  });

  it("tells TypeScript's postfix non-null assertion from a logical not", () => {
    // `const sat = sPct! / 100` in apps/mobile/test/theme.test.mts:110.
    assert.equal(maskSource("const sat = sPct! / 100;\n").error, undefined);
  });

  it("does not keep a ternary branch's string body as if it were a key", () => {
    // `corrupt ? "{not-json" : null` in apps/mobile/test/selfHostAuthority.test.mts:314
    // kept its `{`, which desynced every brace depth after it.
    const masked = maskSource('const v = corrupt ? "{not-json" : null;').masked;
    assert.equal(masked.includes("{"), false, masked);
    // A real property key still survives, which is what the heuristic is for.
    assert.match(maskSource('({ "testTimeout": 1 })').masked, /"testTimeout"/);
  });

  it("keeps its index space aligned across an astral character", () => {
    // `padding: "🙂".repeat(4_100)` in packages/worker/test/
    // migration-0024-session-projection-bounds.test.ts:121 desynced a code-POINT
    // array from a code-UNIT scan, and every string, comment and regex after it
    // in that file was read one position off.
    const source = 'const pad = "🙂".repeat(3);\n// testTimeout: 5000\nconst t = 1;';
    const { masked } = maskSource(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.includes("testTimeout"), false, masked);
    assert.match(masked, /const t = 1;/);
  });
});

describe("requiring the key to be where vitest reads it", () => {
  const shapes = [
    [
      "beside root: and plugins:, the shape a hurried developer writes",
      `export default { root: ".", plugins: [], testTimeout: 30000, test: { environment: "node" } };`,
      /outside the `test` block/,
    ],
    [
      "under test.poolOptions.forks",
      `export default { test: { poolOptions: { forks: { testTimeout: 30000 } } } };`,
      /nested inside `test`/,
    ],
    [
      "under define",
      `export default { define: { testTimeout: 30000 }, test: { environment: "node" } };`,
      /outside the `test` block/,
    ],
    [
      "under server, with an empty test block",
      `export default { server: { testTimeout: 30000 }, test: {} };`,
      /outside the `test` block/,
    ],
    [
      "in one branch of a ternary",
      `export default process.env.CI ? { test: { testTimeout: 30000 } } : { test: {} };`,
      /2 `test` blocks/,
    ],
  ];

  for (const [label, source, pattern] of shapes) {
    it(`fails a declaration ${label}`, () => {
      // Each of these was verified against real vitest 4.1.8: the suite ran at
      // 5000ms and vitest printed no warning about the ignored key.
      const result = readDeclaredTimeout(source, "testTimeout");
      assert.equal(result.value, undefined, label);
      assert.match(result.error, pattern, label);
    });
  }

  it("says the key is misplaced rather than absent, and where", () => {
    // A key in the wrong place is STRONGER evidence of the bug than its
    // absence: the author believed they had set it.
    const source = ["export default {", "  testTimeout: 30000,", "  test: {},", "};"].join("\n");
    const { error } = readDeclaredTimeout(source, "testTimeout");
    assert.match(error, /line 2/);
    assert.match(error, /silently ignores it anywhere else/);
  });

  it("finds the block and its span", () => {
    const masked = maskSource("export default { test: { a: 1 } };").masked;
    const block = findTestBlock(masked);
    assert.equal(masked.slice(block.start, block.end).trim(), "a: 1");
    assert.match(findTestBlock("export default {};").error, /no `test` block/);
    assert.match(findTestBlock("export default { test: { ").error, /never closed/);
  });
});

describe("refusing to follow the command line", () => {
  it("fails every flag that moves or overrides what vitest reads", () => {
    for (const flag of UNRESOLVABLE_FLAGS) {
      const spaced = analyzeScript(`vitest run ${flag} value`);
      assert.equal(spaced.invokes, true, flag);
      assert.equal(spaced.problems.length, 1, flag);
      assert.match(spaced.problems[0], /moves or overrides/, flag);

      const joined = analyzeScript(`vitest run ${flag}=value`);
      assert.equal(joined.problems.length, 1, `${flag}=`);
    }
  });

  it("fails a cd before the invocation and not one after", () => {
    const before = analyzeScript("cd sub && vitest run");
    assert.equal(before.invokes, true);
    assert.match(before.problems[0], /before vitest/);

    assert.deepEqual(analyzeScript("vitest run && cd sub").problems, []);
  });

  it("leaves the invocations this repository actually uses alone", () => {
    for (const script of [
      "vitest run",
      "vitest run test",
      "vitest run --coverage",
      "node --test scripts/pepper-status.node-test.mjs && vitest run",
      "npx vitest run",
    ]) {
      assert.deepEqual(analyzeScript(script).problems, [], script);
    }
  });

  it("splits a script into the segments a shell would run", () => {
    assert.deepEqual(commandSegments("a && b || c ; d | e"), ["a", "b", "c", "d", "e"]);
  });

  it("surfaces a script problem as a workspace problem", () => {
    const root = tree({
      "packages/redirect/package.json": manifest("@x/redirect", "vitest run --testTimeout=1000"),
      "packages/redirect/vitest.config.ts": config(60_000),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /@x\/redirect/);
    assert.match(problems[0], /--testTimeout=1000/);
  });
});

describe("reading a declared value out of source", () => {
  const wrap = (body) => `export default { test: { ${body} } };`;

  it("accepts the spacings and the numeric separator", () => {
    for (const [body, expected] of [
      ["testTimeout: 30000", 30_000],
      ["testTimeout : 30000", 30_000],
      ["testTimeout:30000", 30_000],
      ["testTimeout: 30_000", 30_000],
      ['"testTimeout": 30_000', 30_000],
      ["testTimeout: 60_000,\n hookTimeout: 60_000", 60_000],
    ]) {
      assert.deepEqual(readDeclaredTimeout(wrap(body), "testTimeout"), { value: expected }, body);
    }
  });

  it("does not read a number out of a comment", () => {
    const source = [
      "/**",
      " * Vitest's default testTimeout: 5000 is a contention detector here.",
      " */",
      "export default {",
      "  test: {",
      "    // testTimeout: 5000,",
      "    testTimeout: 30_000,",
      "  },",
      "};",
    ].join("\n");
    assert.deepEqual(readDeclaredTimeout(source, "testTimeout"), { value: 30_000 });
  });

  it("fails loudly rather than passing when it cannot parse", () => {
    for (const [body, pattern] of [
      ["environment: 'node'", /not declared/],
      ["testTimeout: ", /no value/],
      ["testTimeout: TIMEOUT", /not a plain integer literal/],
      ["testTimeout: 30 * 1000", /not a plain integer literal/],
      ["testTimeout: Number(process.env.T)", /not a plain integer literal/],
      ["testTimeout: 30_000, testTimeout: 40_000", /declared 2 times/],
    ]) {
      const result = readDeclaredTimeout(wrap(body), "testTimeout");
      assert.equal(result.value, undefined, body);
      assert.match(result.error, pattern, body);
    }
  });
});

describe("the policy over a workspace", () => {
  it("fails a config that declares testTimeout and not hookTimeout", () => {
    const root = tree({
      "packages/half/package.json": manifest("@x/half"),
      "packages/half/vitest.config.ts": config(30_000, { omit: ["hookTimeout"] }),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /hookTimeout is not declared/);
  });

  it("fails a config that declares hookTimeout and not testTimeout", () => {
    const root = tree({
      "packages/half/package.json": manifest("@x/half"),
      "packages/half/vitest.config.ts": config(30_000, { omit: ["testTimeout"] }),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /testTimeout is not declared/);
  });

  it("fails a value below the floor, which is the defect a number check would pass", () => {
    const root = tree({
      "packages/low/package.json": manifest("@x/low"),
      "packages/low/vitest.config.ts": config(5000),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, REQUIRED_KEYS.length);
    for (const problem of problems) {
      assert.match(problem, /5000ms, below the 20000ms floor/);
      assert.match(problem, /hang bound/);
    }
  });

  it("fails a value above the ceiling, because an hour is not a bound", () => {
    const root = tree({
      "packages/forever/package.json": manifest("@x/forever"),
      "packages/forever/vitest.config.ts": config(3_600_000),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, REQUIRED_KEYS.length);
    for (const problem of problems) {
      assert.match(problem, /3600000ms, above the 300000ms ceiling/);
      assert.match(problem, /stopped bounding anything/);
    }
  });

  it("accepts both ends of the range and refuses one past either", () => {
    const root = tree({
      "packages/floor/package.json": manifest("@x/floor"),
      "packages/floor/vitest.config.ts": config(TIMEOUT_FLOOR_MS),
      "packages/high/package.json": manifest("@x/high"),
      "packages/high/vitest.config.ts": config(60_000),
      "packages/ceiling/package.json": manifest("@x/ceiling"),
      "packages/ceiling/vitest.config.ts": config(TIMEOUT_CEILING_MS),
    });
    assert.deepEqual(checkTestTimeouts(root).problems, []);
    assert.equal(assertTestTimeouts(root).length, 3);

    for (const [value, pattern] of [
      [TIMEOUT_FLOOR_MS - 1, /below the/],
      [TIMEOUT_CEILING_MS + 1, /above the/],
    ]) {
      const edge = tree({
        "packages/edge/package.json": manifest("@x/edge"),
        "packages/edge/vitest.config.ts": config(value),
      });
      const { problems } = checkTestTimeouts(edge);
      assert.equal(problems.length, REQUIRED_KEYS.length, `${value}`);
      assert.match(problems[0], pattern, `${value}`);
    }
  });

  it("reports the values it found, so a pass is evidence", () => {
    const root = tree({
      "packages/one/package.json": manifest("@x/one"),
      "packages/one/vitest.config.ts": config(30_000),
    });
    assert.deepEqual(formatEvidence(checkTestTimeouts(root).results), [
      "  @x/one  packages/one/vitest.config.ts  testTimeout 30000, hookTimeout 30000, no overrides",
    ]);
  });

  it("throws a named error naming the file, the value and the way out", () => {
    const root = tree({
      "packages/low/package.json": manifest("@x/low"),
      "packages/low/vitest.config.ts": config(5000),
    });
    assert.throws(
      () => assertTestTimeouts(root),
      (error) => {
        assert.ok(error instanceof TestTimeoutPolicyError);
        assert.match(error.message, /packages\/low\/vitest\.config\.ts/);
        assert.match(error.message, /5000ms/);
        return true;
      },
    );
  });

  it("treats an unreadable manifest as a problem, not a stack trace", () => {
    const root = tree({ "packages/broken/package.json": "{ not json" });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /packages\/broken\/package\.json cannot be parsed/);
  });
});

describe("translating a glob", () => {
  it("selects what vitest's own default include selects, and nothing else", () => {
    const { regex } = globToRegExp(DEFAULT_INCLUDE[0]);
    for (const path of [
      "a.test.ts",
      "src/views/x.test.tsx",
      "src/x.spec.js",
      "scripts/build.test.mjs",
      "deep/deep/deep/x.test.cjs",
    ]) {
      assert.equal(regex.test(path), true, path);
    }
    for (const path of [
      "src/components/LiveSessionsTable/LiveSessionsTable.tsx",
      "src/marketing/fields/fieldCallouts.tsx",
      "src/views/x.test.ts.snap",
      "src/testing.ts",
      "src/x.test.d.ts",
    ]) {
      assert.equal(regex.test(path), false, path);
    }
  });

  it("handles the shapes this repository's configs use", () => {
    const nested = globToRegExp("test/**/*.test.ts").regex;
    assert.equal(nested.test("test/a.test.ts"), true);
    assert.equal(nested.test("test/support/a.test.ts"), true);
    assert.equal(nested.test("src/a.test.ts"), false);

    const pruned = globToRegExp("**/dist-dashboard/**").regex;
    assert.equal(pruned.test("dist-dashboard/assets/a.test.js"), true);
    assert.equal(pruned.test("src/dist-dashboard/a.test.js"), true);
    assert.equal(pruned.test("src/a.test.js"), false);

    assert.equal(globToRegExp("*.{a,b}").regex.test("x.b"), true);
    assert.equal(globToRegExp("*.[jt]s").regex.test("x.ts"), true);
    assert.equal(globToRegExp("x?.ts").regex.test("xy.ts"), true);
    assert.equal(globToRegExp("x?.ts").regex.test("xyz.ts"), false);
    assert.equal(globToRegExp("a/*/b").regex.test("a/x/y/b"), false);
  });

  it("refuses a construct it does not translate rather than matching nothing", () => {
    for (const pattern of ["!**/x.test.ts", "**/!(a).test.ts", "**/{a,b.test.ts", "**/[ab.test.ts"]) {
      const { regex, error } = globToRegExp(pattern);
      assert.equal(regex, undefined, pattern);
      assert.ok(error.includes(pattern) || error.length > 0, pattern);
    }
  });
});

describe("scoping the scan to the files vitest would run", () => {
  it("reads include and exclude out of the test block, and falls back to vitest's defaults", () => {
    const declared = [
      "export default { test: {",
      '  include: ["test/**/*.test.ts"],',
      '  exclude: ["**/node_modules/**", "**/dist/**"],',
      "} };",
    ].join("\n");
    assert.deepEqual(readDeclaredStringArray(declared, "include"), {
      values: ["test/**/*.test.ts"],
    });
    assert.deepEqual(readDeclaredStringArray(declared, "exclude"), {
      values: ["**/node_modules/**", "**/dist/**"],
    });
    assert.deepEqual(readDeclaredStringArray("export default { test: {} };", "include"), {
      absent: true,
    });
  });

  it("fails an include this gate cannot read rather than scanning a guess", () => {
    for (const [body, pattern] of [
      ["include: PATTERNS", /not an array literal/],
      ['include: ["a", ...more]', /not a plain string literal/],
      ['include: ["a" + suffix]', /not a plain string literal/],
      ["include: [`test/${dir}/*.test.ts`]", /not a plain string literal/],
    ]) {
      const result = readDeclaredStringArray(`export default { test: { ${body} } };`, "include");
      assert.equal(result.values, undefined, body);
      assert.match(result.error, pattern, body);
    }
  });

  it("accepts a root that provably means the config's own directory and refuses one that moves", () => {
    for (const value of ["import.meta.dirname", "__dirname", '"."', "'./'"]) {
      assert.deepEqual(
        readDeclaredRoot(`export default { root: ${value}, test: {} };`),
        { ok: true },
        value,
      );
    }
    const moved = readDeclaredRoot('export default { root: "dashboard", test: {} };');
    assert.match(moved.error, /moves where vitest looks for tests/);
    assert.match(moved.error, /will not follow a redirect/);
  });

  it("selects only include-matched files, and prunes the directories exclude names", () => {
    const root = tree({
      "packages/w/package.json": manifest("@x/w"),
      "packages/w/src/Widget.tsx": "const t = setTimeout(() => {}, 260);\n",
      "packages/w/src/Widget.test.tsx": "it('x', () => {});\n",
      "packages/w/src/nested/deep.spec.mts": "it('y', () => {});\n",
      "packages/w/dist/bundled.test.js": "it('z', () => {}, 5);\n",
      "packages/w/node_modules/dep/dep.test.js": "it('n', () => {}, 5);\n",
    });
    assert.deepEqual(
      testFilesIn(root, "packages/w", DEFAULT_INCLUDE, ["**/node_modules/**", "**/dist/**"]).files,
      ["packages/w/src/Widget.test.tsx", "packages/w/src/nested/deep.spec.mts"],
    );
    // PRODUCT SOURCE IS UNREACHABLE BY CONSTRUCTION, not by an exclusion list:
    // Widget.tsx is not a *.test.* file, so no include pattern names it and its
    // `setTimeout(fn, 260)` is never read.
    assert.deepEqual(testFilesIn(root, "packages/w", ["test/**/*.test.ts"], DEFAULT_EXCLUDE).files, []);
  });
});

describe("reading a per-test override off the call that owns it", () => {
  const scan = (source) => findTimeoutOverrides(source);

  it("anchors on the callee, so a setTimeout closing brace is not a near miss", () => {
    // The `}, <number>)` scan this replaced matched every one of these. None of
    // them is a call this gate anchors on, so none needs excluding by name.
    const source = [
      "it('scrolls the focused row into view', async () => {",
      "  const t = setTimeout(() => {",
      "    el.scrollIntoView({ behavior: 'smooth' });",
      "  }, 260);",
      "  await new Promise((resolve) => {",
      "    queue.push(() => resolve('written'));",
      "  }, 5);",
      "  expect(re.test(value)).toBe(true);",
      "});",
      "for (const it of items) place(it, node);",
    ].join("\n");
    assert.deepEqual(scan(source), { overrides: [], problems: [] });
  });

  it("reads a trailing integer on a test and on a hook, against the right global", () => {
    const { overrides, problems } = scan(
      [
        "beforeAll(async () => {",
        "  await load();",
        "}, 30_000);",
        "",
        "it('is slow', async () => {",
        "  await run();",
        "}, 900_000);",
      ].join("\n"),
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(
      overrides.map(({ line, callee, kind, value }) => ({ line, callee, kind, value })),
      [
        { line: 1, callee: "beforeAll", kind: "hook", value: 30_000 },
        { line: 5, callee: "it", kind: "test", value: 900_000 },
      ],
    );
  });

  it("reads the options-object form", () => {
    for (const source of [
      "it('x', { timeout: 5000 }, () => {});",
      "it('x', { retry: 2, timeout: 5_000 }, async () => {});",
      "describe('x', { timeout: 5000 }, () => { it('y', () => {}); });",
      "it('x', { timeout: 5000 });",
    ]) {
      const { overrides, problems } = scan(source);
      assert.deepEqual(problems, [], source);
      assert.equal(overrides[0]?.value, 5000, source);
    }
    // A nested `timeout:` belongs to something else and is not the call's own.
    assert.deepEqual(scan("it('x', { poolOptions: { timeout: 5000 } }, () => {});").overrides, []);
  });

  it("walks past the first group, because it.each puts the timeout in the second", () => {
    const each = scan("it.each([[1], [2]])('case %i', (n) => { use(n); }, 5_000);");
    assert.deepEqual(each.problems, []);
    assert.deepEqual(
      each.overrides.map(({ callee, value }) => ({ callee, value })),
      [{ callee: "it.each", value: 5000 }],
    );
    // The table itself must not be mistaken for the argument list. The second
    // of these was a real false positive: with only one group the digit rule
    // read the trailing `3` of the table as a timeout.
    assert.deepEqual(scan("it.each([[1], [2]])('case %i', (n) => { use(n); });").overrides, []);
    assert.deepEqual(scan("const cases = it.each([1, 2, 3]);"), { overrides: [], problems: [] });

    // A tagged-template table sits between the callee and its argument list.
    const tagged = scan("it.each`\n  a | b\n  ${1} | ${2}\n`('case', ({ a }) => { use(a); }, 5_000);");
    assert.deepEqual(tagged.problems, []);
    assert.equal(tagged.overrides[0]?.value, 5000);
  });

  it("follows the member chains vitest actually offers", () => {
    for (const [source, callee] of [
      ["it.skip('x', () => {}, 5000);", "it.skip"],
      ["it.concurrent('x', () => {}, 5000);", "it.concurrent"],
      ["test.only('x', () => {}, 5000);", "test.only"],
      ["describe.sequential('x', () => {}, 5000);", "describe.sequential"],
      ["it.concurrent.each([1])('x', (n) => {}, 5000);", "it.concurrent.each"],
      ["it.skipIf(slow)('x', () => {}, 5000);", "it.skipIf"],
      ["bench('x', () => {}, 5000);", "bench"],
      ["afterEach(() => {}, 5000);", "afterEach"],
    ]) {
      const { overrides, problems } = scan(source);
      assert.deepEqual(problems, [], source);
      assert.equal(overrides[0]?.callee, callee, source);
      assert.equal(overrides[0]?.value, 5000, source);
    }
  });

  it("resolves a single-file integer constant, which is how worker writes five of its own", () => {
    const source = ["const SLOW = 900_000;", "it('scale', async () => {", "  await run();", "}, SLOW);"].join("\n");
    assert.deepEqual(scan(source).problems, []);
    assert.deepEqual(scan(source).overrides[0].value, 900_000);
    assert.equal(scan(source).overrides[0].via, "SLOW");
    assert.equal(integerConstants("const A = 1;\nconst B = x;").get("A"), 1);
    assert.equal(integerConstants("const A = 1;\nconst A = 2;").get("A"), undefined);
  });

  it("fails a timeout it cannot resolve rather than passing it", () => {
    for (const [source, pattern] of [
      ["it('x', () => {}, 30 * 1000);", /not a plain integer literal/],
      ["it('x', () => {}, TIMEOUT);", /not a `const` bound once to a plain integer literal/],
      ["beforeAll(() => {}, timeouts.slow);", /not a plain integer literal/],
      ["it('x', { timeout: SLOW }, () => {});", /not a `const` bound once/],
    ]) {
      const { overrides, problems } = scan(source);
      assert.deepEqual(overrides, [], source);
      assert.equal(problems.length, 1, source);
      assert.match(problems[0], pattern, source);
      assert.match(problems[0], /line 1/, source);
    }
  });

  it("does not invent a timeout out of an ordinary call", () => {
    for (const source of [
      "it('x', () => {});",
      "it('x', async () => { await run(); });",
      "describe('x', () => { it('y', () => {}); });",
      "beforeEach(reset);",
      "import { describe, it, expect } from 'vitest';",
      "const cases = it.each;",
      "expect(schema.test).toBe(undefined);",
      "// it('x', () => {}, 5);",
      "const doc = \"it('x', () => {}, 5)\";",
    ]) {
      assert.deepEqual(scan(source), { overrides: [], problems: [] }, source);
    }
  });

  it("matches the brackets a call owns", () => {
    assert.equal(matchDelimiter("f(a, (b), [c])", 1), 13);
    assert.equal(matchDelimiter("f(a", 1), undefined);
    assert.deepEqual(
      topLevelArguments("f(a, {b: 1}, (c, d))", 2, 19).map((argument) => argument.text),
      ["a", "{b: 1}", "(c, d)"],
    );
  });
});

describe("the direction of the per-test rule", () => {
  const workspace = (body) => ({
    "packages/scale/package.json": manifest("@x/scale"),
    "packages/scale/vitest.config.ts": config(60_000),
    "packages/scale/test/budget.test.ts": body,
  });

  it("passes an override above the global, which is what keeps worker's 900_000 working", () => {
    const root = tree(workspace('it("holds the op budget", async () => { await run(); }, 900_000);\n'));
    assert.deepEqual(checkTestTimeouts(root).problems, []);
  });

  it("passes an override exactly equal to the global", () => {
    const root = tree(workspace('it("equals", async () => { await run(); }, 60_000);\n'));
    assert.deepEqual(checkTestTimeouts(root).problems, []);
  });

  it("fails an override below the global, naming the file, the line, the value and the global", () => {
    const root = tree(workspace('it("undercuts", async () => {\n  await run();\n}, 30_000);\n'));
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /packages\/scale\/test\/budget\.test\.ts:1/);
    assert.match(problems[0], /`it` overrides testTimeout with 30000ms/);
    assert.match(problems[0], /below the 60000ms packages\/scale\/vitest\.config\.ts declares/);
    assert.match(problems[0], /hang bound bought once for the whole suite/);
  });

  it("measures a hook against hookTimeout and a test against testTimeout", () => {
    const root = tree({
      "packages/split/package.json": manifest("@x/split"),
      "packages/split/vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        "export default defineConfig({ test: { testTimeout: 20_000, hookTimeout: 200_000 } });",
      ].join("\n"),
      "packages/split/test/a.test.ts": [
        'it("fine at 30s against a 20s test bound", () => {}, 30_000);',
        "beforeAll(() => {}, 30_000);",
      ].join("\n"),
    });
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /`beforeAll` overrides hookTimeout with 30000ms, below the 200000ms/);
  });

  it("names every override on a passing run, so the direction is visible not asserted", () => {
    const root = tree(workspace('it("scale", () => {}, 900_000);\nbeforeAll(() => {}, 900_000);\n'));
    assert.deepEqual(formatEvidence(checkTestTimeouts(root).results), [
      "  @x/scale  packages/scale/vitest.config.ts  testTimeout 60000, hookTimeout 60000, 2 override(s)",
      "      packages/scale/test/budget.test.ts:1  it  900000 >= testTimeout 60000",
      "      packages/scale/test/budget.test.ts:2  beforeAll  900000 >= hookTimeout 60000",
    ]);
  });

  it("does not read a test file the workspace's own include leaves out", () => {
    const root = tree({
      "packages/narrow/package.json": manifest("@x/narrow"),
      "packages/narrow/vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        "export default defineConfig({",
        '  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },',
        "});",
      ].join("\n"),
      "packages/narrow/test/run.test.ts": 'it("in scope", () => {}, 900_000);\n',
      "packages/narrow/src/legacy.test.ts": 'it("out of scope", () => {}, 5);\n',
    });
    const [result] = checkTestTimeouts(root).results;
    assert.deepEqual(checkTestTimeouts(root).problems, []);
    assert.deepEqual(
      result.overrides.map((override) => override.file),
      ["packages/narrow/test/run.test.ts"],
    );
  });

  it("surfaces an unreadable override as a workspace problem", () => {
    const root = tree(workspace('it("computed", () => {}, 30 * 1000);\n'));
    const { problems } = checkTestTimeouts(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /packages\/scale\/test\/budget\.test\.ts/);
    assert.match(problems[0], /cannot read/);
  });
});

describe("this repository", () => {
  it("is wired where it runs, in both halves", () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["test-timeouts:check"], "node scripts/check-test-timeouts.mjs");
    assert.equal(
      pkg.scripts["test-timeouts:test"],
      "node --test scripts/check-test-timeouts.test.mjs",
    );
    assert.match(pkg.scripts.test, /test-timeouts:test/);
    assert.match(pkg.scripts.test, /test-timeouts:check/);

    // WIRING IS PER-REPOSITORY, for the reason `check-isolated-git.test.mjs`
    // records: the public tree carries two workspaces that run vitest
    // (@seorak/collector and @seorak/web) and a contributor there runs them
    // under the same kind of hook. The `open-core/` paths are absent from the
    // assembled public tree, where this file's own root IS the public root, so
    // the loop skips what it cannot find rather than asserting a layout.
    for (const path of [
      ".github/workflows/ci.yml",
      "open-core/.github/workflows/ci.yml",
      "open-core/package.json",
    ]) {
      let source;
      try {
        source = readFileSync(resolve(REPO_ROOT, path), "utf8");
      } catch {
        continue;
      }
      assert.match(source, /npm run test-timeouts:test/, path);
      assert.match(source, /npm run test-timeouts:check/, path);
    }
  });
});
