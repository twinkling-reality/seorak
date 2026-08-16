import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { gitSpawn } from "./isolated-git.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  analyzeOpenCoreBoundaries,
  assetBindings,
  cssSpecifiers,
} from "./check-open-core-boundaries.mjs";
import {
  absenceIsExpected,
  boundaryPolicies,
  classifyPath,
  exitCodeFor,
  holdsPrivateHalf,
  isPublicFile,
  loadOwnership,
  mayImport,
  readAcceptance,
  reconcile,
  redactionPendingFor,
} from "./open-core-ownership.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS, "..");
const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

const VISIBILITIES = {
  public: { summary: "public", mayImport: ["public", "split"] },
  split: { summary: "split", mayImport: ["public", "split"] },
  mixed: { summary: "mixed", mayImport: ["public", "split"] },
  private: {
    summary: "private",
    mayImport: ["public", "private", "split", "mixed", "excluded"],
  },
  excluded: { summary: "excluded", mayImport: [] },
};

function manifestFixture({
  paths,
  workspaces = [],
  coverage,
  developmentFilePatterns = [],
  publicFileSet,
}) {
  return {
    schemaVersion: 2,
    visibilities: VISIBILITIES,
    publicFileSet: publicFileSet ?? {
      visibilities: ["public", "split"],
      redactionPending: [],
    },
    coverage: coverage ?? { roots: ["packages"], rootFiles: [], outOfScope: [] },
    developmentFilePatterns,
    workspaces:
      workspaces.length > 0
        ? workspaces
        : [
            {
              package: "@seorak/pub",
              root: "packages/pub",
              visibility: "public",
              sourceRoots: [{ path: "src", mode: "production" }],
              allowedInternalPackages: [],
              moduleLoaders: "forbidden",
              why: "fixture",
            },
          ],
    paths,
  };
}

/** Compile a fixture manifest through the real loader so validation runs. */
function compiled(manifest) {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-ownership-"));
  temporaryRoots.push(root);
  mkdirSync(resolve(root, "docs/reference"), { recursive: true });
  writeFileSync(
    resolve(root, "docs/reference/open-core-ownership.json"),
    JSON.stringify(manifest),
  );
  return { root, ...loadOwnership(root) };
}

function rule(pattern, visibility, extra = {}) {
  return { pattern, visibility, source: "b1a", why: "fixture", ...extra };
}

test("the shipped ownership map loads, covers every workspace, and places every file", () => {
  const { manifest, problems } = loadOwnership(REPO_ROOT);
  assert.deepEqual(problems, []);
  // READ FROM THE TREE, not written down. This asserted 9 workspaces and 8
  // policies, and stayed at 9 and 8 after B6 added packages/dashboard: a
  // literal count is a measurement of the day it was typed. The property is
  // that the map and the tree agree in both directions.
  const present = ["packages", "apps"]
    .filter((root) => existsSync(resolve(REPO_ROOT, root)))
    .flatMap((root) =>
      readdirSync(resolve(REPO_ROOT, root), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${root}/${entry.name}`),
    );
  const placed = new Set(manifest.workspaces.map((entry) => entry.root));
  for (const root of present) {
    assert.ok(placed.has(root), `${root} is a workspace the map does not place`);
  }
  // And nothing the map places is gone, EXCEPT in a tree that holds one half of
  // the split, where the other half's workspaces are absent by construction.
  const holdsPrivate = holdsPrivateHalf(manifest, REPO_ROOT);
  for (const workspace of manifest.workspaces) {
    if (absenceIsExpected(manifest, `${workspace.root}/package.json`, holdsPrivate)) continue;
    assert.ok(present.includes(workspace.root), `${workspace.root} is placed and is not in the tree`);
  }
  // `apps/menubar` used to be pinned here as the one workspace with no npm
  // manifest, proving visibility is a property of a workspace rather than of a
  // package.json. That surface was removed on 2026-08-08 and every remaining
  // workspace has a manifest, so the assertion below is now the whole story.
  assert.equal(
    boundaryPolicies(manifest).length,
    manifest.workspaces.filter((entry) => entry.package !== null).length,
    "one policy per workspace the map gives a package name",
  );
  // The workspace whose name carries no `@seorak/` prefix is the reason the
  // prefix test had to go.
  assert.ok(manifest.workspaces.some((entry) => entry.package === "seorak-app"));
});

test("most specific rule wins, and an equal-specificity disagreement is an error", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [
        rule("packages/web/**", "private"),
        rule("packages/web/src/**", "public"),
        rule("packages/web/src/marketing/**", "private"),
        rule("packages/web/public/fonts/**", "excluded"),
      ],
    }),
  );
  assert.equal(classifyPath(manifest, "packages/web/README.md").visibility, "private");
  assert.equal(classifyPath(manifest, "packages/web/src/lib/api.ts").visibility, "public");
  assert.equal(
    classifyPath(manifest, "packages/web/src/marketing/paths.ts").visibility,
    "private",
  );
  assert.equal(
    classifyPath(manifest, "packages/web/public/fonts/x.woff").visibility,
    "excluded",
  );
  assert.equal(classifyPath(manifest, "apps/mobile/index.ts"), undefined);

  const ambiguous = compiled(
    manifestFixture({
      paths: [rule("packages/*/src/**", "public"), rule("packages/pub/*/**", "private")],
    }),
  );
  const placement = classifyPath(ambiguous.manifest, "packages/pub/src/index.ts");
  assert.deepEqual(placement.ambiguousWith.length, 1);
});

test("a visibility class is data, so adding one is an edit to the manifest alone", () => {
  const { manifest, problems } = compiled({
    ...manifestFixture({ paths: [rule("packages/**", "quarantined")] }),
    visibilities: {
      ...VISIBILITIES,
      quarantined: { summary: "a tenth class", mayImport: [] },
    },
  });
  assert.deepEqual(problems, []);
  assert.equal(classifyPath(manifest, "packages/pub/src/a.ts").visibility, "quarantined");
  assert.equal(mayImport(manifest, "quarantined", "public"), false);
});

test("a manifest that names an unknown visibility or skips a why does not load", () => {
  assert.match(
    compiled(manifestFixture({ paths: [rule("packages/**", "invented")] })).problems[0],
    /unknown visibility invented/,
  );
  assert.match(
    compiled(
      manifestFixture({ paths: [{ pattern: "packages/**", visibility: "public", source: "b1a" }] }),
    ).problems[0],
    /has no why/,
  );
  assert.match(
    compiled(manifestFixture({ paths: [rule("packages/**", "mixed")] })).problems[0],
    /only a workspace may carry/,
  );
});

test("the public file set is schema, and a conditional placement needs a date", () => {
  const base = manifestFixture({ paths: [rule("packages/**", "public")] });

  const missing = { ...base };
  delete missing.publicFileSet;
  assert.match(compiled(missing).problems[0], /has no publicFileSet block/);

  assert.match(
    compiled({
      ...base,
      publicFileSet: { visibilities: ["mixed"], redactionPending: [] },
    }).problems[0],
    /only a workspace may carry/,
  );
  assert.match(
    compiled({ ...base, publicFileSet: { visibilities: ["public"] } }).problems[0],
    /no redactionPending list/,
  );
  assert.match(
    compiled({
      ...base,
      publicFileSet: {
        visibilities: ["public"],
        redactionPending: [{ pattern: "SETUP.md", why: "" }],
      },
    }).problems[0],
    /needs a pattern, a why, and an owner/,
  );

  // A condition is an acceptance. Undated, it is renewed by nobody, which is
  // how a placement waiting on B7 becomes a claim nobody remembers making.
  assert.match(
    compiled(
      manifestFixture({
        paths: [rule("packages/**", "public", { condition: "c", conditionOwner: "B7" })],
      }),
    ).problems[0],
    /no conditionAcceptedOn date/,
  );
});

test("a redaction-pending file is IN the public file set, not outside it", () => {
  const { manifest } = compiled(
    manifestFixture({
      publicFileSet: {
        visibilities: ["public", "split"],
        redactionPending: [{ pattern: "SETUP.md", why: "fixture", owner: "C1" }],
      },
      coverage: { roots: ["packages"], rootFiles: ["SETUP.md"], outOfScope: [] },
      paths: [
        rule("packages/pub/**", "public"),
        rule("packages/priv/**", "private"),
        rule("packages/split/**", "split"),
        rule("SETUP.md", "split"),
      ],
    }),
  );

  assert.equal(isPublicFile(manifest, "packages/pub/src/a.ts"), true);
  assert.equal(isPublicFile(manifest, "packages/priv/src/a.ts"), false);
  // Split is held to the public rule, so its public half ships and an
  // identifier in it ships with it.
  assert.equal(isPublicFile(manifest, "packages/split/src/a.ts"), true);
  // A path nobody placed is not in the set; coverage is what makes that loud.
  assert.equal(isPublicFile(manifest, "packages/unplaced/a.ts"), false);

  assert.equal(isPublicFile(manifest, "SETUP.md"), true);
  assert.equal(redactionPendingFor(manifest, "SETUP.md").owner, "C1");
  assert.equal(redactionPendingFor(manifest, "packages/pub/src/a.ts"), undefined);
});

test("CSS edges are read, because an import gate that skips them reports clean", () => {
  assert.deepEqual(
    cssSpecifiers(`
      @import '../marketing/styles/tokens.css';
      @import url("./local.css");
      /* @import './commented-out.css'; */
      .a { background: url('/assets/logo.svg'); }
      .b { background: url(data:image/svg+xml;base64,AAA); }
      .c { background: url("https://cdn.example.com/x.png"); }
    `),
    [
      "../marketing/styles/tokens.css",
      "./local.css",
      "./local.css",
      "/assets/logo.svg",
    ],
  );
});

test("every assets directory and site bucket is parsed, including env overrides", () => {
  const { bindings, problems } = assetBindings(`
name = "worker"
directory = "not-an-assets-table"

[assets]
directory = "../web/dist"
not_found_handling = "single-page-application"

[site]
bucket = "./public"   # comments are stripped

[env.staging.assets]
directory = "../web/dist-staging"
`);
  assert.deepEqual(problems, []);
  assert.deepEqual(bindings, [
    { table: "assets", key: "directory", value: "../web/dist" },
    { table: "site", key: "bucket", value: "./public" },
    { table: "env.staging.assets", key: "directory", value: "../web/dist-staging" },
  ]);
});

test("a binding this reader cannot resolve is reported, never skipped", () => {
  const { bindings, problems } = assetBindings(`
[assets]
directory = { from = "somewhere" }
`);
  assert.deepEqual(bindings, []);
  assert.match(problems[0], /\[assets\] directory is not a plain string/);
});

test("a public file reading a private one is a finding; the reverse is not", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [
        rule("packages/pub/**", "public"),
        rule("packages/priv/**", "private"),
        rule("packages/fonts/**", "excluded"),
      ],
      coverage: { roots: ["packages"], rootFiles: [], outOfScope: [] },
    }),
  );
  const files = {
    "packages/pub/src/leak.ts": `import { x } from "../../priv/src/secret.js";`,
    "packages/pub/src/fine.ts": `import { y } from "./other.js";`,
    "packages/pub/src/other.ts": "export const y = 1;",
    "packages/pub/src/theme.css": `@font-face { src: url('../../fonts/face.woff'); }`,
    "packages/priv/src/secret.ts": `import { y } from "../../pub/src/other.js";`,
    "packages/fonts/face.woff": "",
  };
  const result = analyzeOpenCoreBoundaries(
    manifest,
    Object.keys(files),
    (path) => files[path],
  );
  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.findings.map((finding) => finding.key),
    [
      "import::packages/pub/src/leak.ts::../../priv/src/secret.js",
      "import::packages/pub/src/theme.css::../../fonts/face.woff",
    ],
  );
  assert.match(result.findings[0].detail, /\(public\) reads packages\/priv\/src\/secret\.ts \(private\)/);
});

test("an unplaced file and a rule that matches nothing both fail hard", () => {
  const { manifest } = compiled(
    manifestFixture({ paths: [rule("packages/pub/**", "public"), rule("packages/gone/**", "private")] }),
  );
  const result = analyzeOpenCoreBoundaries(
    manifest,
    ["packages/pub/src/a.ts", "packages/orphan/b.ts"],
    () => "",
  );
  assert.ok(
    result.problems.some((problem) => /packages\/orphan\/b\.ts matches no ownership rule/.test(problem)),
  );
  assert.ok(
    result.problems.some((problem) => /packages\/gone\/\*\* matches no tracked file/.test(problem)),
  );
});

// The mirror of the case below, and the one the map could not express. A file
// that exists ONLY in the public repository — the Apache-2.0 root grant
// governance forbids at the private root, the publish workflow npm binds by
// filename — matches nothing HERE by construction. Unplaced, both classified as
// not-public, which made `holdsPrivateHalf` true in the public repository
// itself and failed its boundary gate on every push since it was created.
test("a public-repository-only rule matching nothing is expected here, and an ordinary one is not", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [
        rule("packages/pub/**", "public"),
        rule("LICENSE", "public", { publicRepositoryOnly: true }),
        rule("packages/gone/**", "public"),
      ],
    }),
  );
  const result = analyzeOpenCoreBoundaries(manifest, ["packages/pub/src/a.ts"], () => "", true);

  assert.deepEqual(result.unmatchedPublicOnlyRules, ["LICENSE"]);
  assert.ok(
    !result.problems.some((problem) => problem.includes("LICENSE matches no tracked file")),
    "a declared public-repository-only rule must not be a finding here",
  );
  // The exemption is declared per rule, never inferred from visibility: an
  // ordinary public rule that stops matching really has lost its directory.
  assert.ok(
    result.problems.some((problem) => problem.includes("packages/gone/** matches no tracked file")),
    "an undeclared public rule matching nothing must still fail",
  );
});

test("in the public half alone, a private rule matching nothing is expected and a public one is not", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [
        rule("packages/pub/**", "public"),
        rule("packages/priv/**", "private"),
        rule("packages/gone/**", "public"),
        rule("staging/**", "public", { relocatedTo: "the tree root" }),
      ],
    }),
  );
  const paths = ["packages/pub/src/a.ts"];

  // The repository that owns both halves: every one of the three is a rule
  // protecting a directory that is not there.
  const both = analyzeOpenCoreBoundaries(manifest, paths, () => "");
  for (const pattern of ["packages/priv", "packages/gone", "staging"]) {
    assert.ok(
      both.problems.some((problem) => problem.includes(`${pattern}/** matches no tracked file`)),
      `${pattern} should fail in a tree that holds both halves`,
    );
  }

  // The public half alone: the private rule and the relocated one are absent by
  // construction, and the PUBLIC rule still fails, because that directory
  // really is gone from the repository that was supposed to carry it.
  const publicOnly = analyzeOpenCoreBoundaries(manifest, paths, () => "", false);
  assert.deepEqual(publicOnly.problems, [
    "ownership rule packages/gone/** matches no tracked file; remove it",
  ]);
  assert.deepEqual(publicOnly.unmatchedPrivateRules, [
    "packages/priv/**",
    "staging/** (relocated to the tree root)",
  ]);
});

test("an asset binding that crosses a workspace or mixes visibilities is reported", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [
        rule("packages/cloud/**", "private"),
        rule("packages/web/**", "private"),
        rule("packages/web/assets/icon.svg", "public"),
        rule("packages/web/assets/brand.svg", "private"),
      ],
      workspaces: [
        {
          package: "@seorak/cloud",
          root: "packages/cloud",
          visibility: "private",
          sourceRoots: [{ path: "src", mode: "production" }],
          allowedInternalPackages: [],
          moduleLoaders: "allowed",
          why: "fixture",
        },
      ],
    }),
  );
  const files = {
    "packages/cloud/wrangler.toml": `[assets]\ndirectory = "../web/assets"\n`,
    "packages/web/assets/icon.svg": "",
    "packages/web/assets/brand.svg": "",
  };
  const result = analyzeOpenCoreBoundaries(manifest, Object.keys(files), (path) => files[path]);
  assert.deepEqual(result.bindingCount, 1);
  const keys = result.findings.map((finding) => finding.key);
  assert.ok(keys.includes("asset-crosses-workspace::packages/cloud/wrangler.toml::assets.directory"));
  assert.ok(keys.includes("asset-mixed-visibility::packages/cloud/wrangler.toml::assets.directory"));
});

test("an asset binding at a build output is reported rather than passed over", () => {
  const { manifest } = compiled(
    manifestFixture({
      paths: [rule("packages/cloud/**", "private")],
      workspaces: [
        {
          package: "@seorak/cloud",
          root: "packages/cloud",
          visibility: "private",
          sourceRoots: [{ path: "src", mode: "production" }],
          allowedInternalPackages: [],
          moduleLoaders: "allowed",
          why: "fixture",
        },
      ],
    }),
  );
  const files = { "packages/cloud/wrangler.toml": `[assets]\ndirectory = "./dist"\n` };
  const result = analyzeOpenCoreBoundaries(manifest, Object.keys(files), (path) => files[path]);
  assert.deepEqual(
    result.findings.map((finding) => finding.key),
    ["asset-unplaceable::packages/cloud/wrangler.toml::assets.directory"],
  );
});

test("an acceptance entry without a falsification condition or a date is rejected", () => {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-acceptance-"));
  temporaryRoots.push(root);
  mkdirSync(resolve(root, "docs/reference"), { recursive: true });
  const write = (entries) =>
    writeFileSync(
      resolve(root, "docs/reference/open-core-boundary-acceptance.json"),
      JSON.stringify({ schemaVersion: 1, entries }),
    );

  write([{ check: "open-core-boundaries", key: "k", acceptedOn: "2026-08-04", why: "w" }]);
  assert.match(readAcceptance(root).problems[0], /is missing falsifiedWhen/);

  write([
    { check: "open-core-boundaries", key: "k", acceptedOn: "soon", why: "w", falsifiedWhen: "f" },
  ]);
  assert.match(readAcceptance(root).problems[0], /malformed acceptedOn/);

  const good = {
    check: "open-core-boundaries",
    key: "k",
    acceptedOn: "2026-08-04",
    why: "w",
    falsifiedWhen: "f",
  };
  write([good, good]);
  assert.match(readAcceptance(root).problems[0], /duplicates open-core-boundaries::k/);

  write([good]);
  assert.deepEqual(readAcceptance(root).problems, []);
});

test("acceptance is scoped per check, so one gate cannot stale another's entries", () => {
  const entries = [
    { check: "package-boundaries", key: "a", acceptedOn: "2026-08-04", why: "w", falsifiedWhen: "f" },
    { check: "open-core-boundaries", key: "b", acceptedOn: "2026-08-04", why: "w", falsifiedWhen: "f" },
  ];
  const reconciliation = reconcile([{ key: "b", detail: "d" }], entries, "open-core-boundaries");
  assert.equal(reconciliation.accepted.length, 1);
  assert.deepEqual(reconciliation.stale, []);
  assert.deepEqual(reconciliation.undeclared, []);
});

test("undeclared fails, accepted passes, stale fails, and strict fails on both", () => {
  const accepted = { key: "known", detail: "d" };
  const entry = {
    check: "c",
    key: "known",
    acceptedOn: "2026-08-04",
    why: "w",
    falsifiedWhen: "f",
  };
  const base = { problems: [] };
  assert.equal(
    exitCodeFor({ ...base, reconciliation: reconcile([accepted], [entry], "c"), strict: false }),
    0,
  );
  assert.equal(
    exitCodeFor({ ...base, reconciliation: reconcile([accepted], [entry], "c"), strict: true }),
    1,
  );
  assert.equal(
    exitCodeFor({
      ...base,
      reconciliation: reconcile([{ key: "fresh", detail: "d" }], [entry], "c"),
      strict: false,
    }),
    1,
  );
  assert.equal(
    exitCodeFor({ ...base, reconciliation: reconcile([], [entry], "c"), strict: false }),
    1,
  );
  assert.equal(
    exitCodeFor({
      problems: ["anything"],
      reconciliation: reconcile([], [], "c"),
      strict: false,
    }),
    1,
  );
});

/**
 * The proof that matters. The sibling types gate shipped enforcement behind an
 * opt-in flag and was wired into `npm test` without it, so a new undeclared
 * placement printed a line and CI stayed green. This runs both executables the
 * way CI runs them, with no flags, against a repository that is clean, and then
 * plants one fresh violation of each kind and asserts a non-zero exit.
 */
function plantedFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-planted-"));
  temporaryRoots.push(root);
  const write = (path, contents) => {
    const destination = resolve(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  };

  write(
    "docs/reference/open-core-ownership.json",
    JSON.stringify(
      manifestFixture({
        coverage: { roots: ["packages"], rootFiles: [], outOfScope: [] },
        developmentFilePatterns: ["**/*.test.*"],
        workspaces: [
          {
            package: "@seorak/pub",
            root: "packages/pub",
            visibility: "public",
            sourceRoots: [{ path: "src", mode: "production" }],
            allowedInternalPackages: [],
            moduleLoaders: "forbidden",
            why: "fixture",
          },
          {
            package: "@seorak/priv",
            root: "packages/priv",
            visibility: "private",
            sourceRoots: [{ path: "src", mode: "production" }],
            allowedInternalPackages: ["@seorak/pub"],
            moduleLoaders: "allowed",
            why: "fixture",
          },
        ],
        paths: [rule("packages/pub/**", "public"), rule("packages/priv/**", "private")],
      }),
    ),
  );
  write(
    "docs/reference/open-core-boundary-acceptance.json",
    JSON.stringify({ schemaVersion: 1, entries: [] }),
  );
  write(
    "packages/pub/package.json",
    JSON.stringify({ name: "@seorak/pub", exports: { ".": "./src/index.ts" } }),
  );
  write("packages/pub/src/index.ts", "export const x = 1;\n");
  write(
    "packages/priv/package.json",
    JSON.stringify({ name: "@seorak/priv", dependencies: { "@seorak/pub": "*" } }),
  );
  // Private reading public by package name is the one legal direction, so the
  // baseline this fixture starts from is genuinely clean.
  write("packages/priv/src/index.ts", `import { x } from "@seorak/pub";\nexport const y = x;\n`);

  for (const argv of [
    ["init", "-q"],
    ["config", "user.email", "gate@example.invalid"],
    ["config", "user.name", "gate"],
    ["add", "-A"],
  ]) {
    const result = gitSpawn(argv, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  return { root, write };
}

function runGate(script, root) {
  return spawnSync("node", [resolve(SCRIPTS, script), `--root=${root}`], {
    encoding: "utf8",
  });
}

test("a planted public-to-private import fails the shipped executable with no flags", () => {
  const { root, write } = plantedFixture();

  const clean = runGate("check-open-core-boundaries.mjs", root);
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /Undeclared violations \(0\)/);

  write("packages/pub/src/planted.ts", `import { y } from "../../priv/src/index.js";\nexport const z = y;\n`);
  const planted = runGate("check-open-core-boundaries.mjs", root);
  assert.equal(planted.status, 1, planted.stdout);
  assert.match(planted.stdout, /Undeclared violations \(1\)/);
  assert.match(
    planted.stdout,
    /packages\/pub\/src\/planted\.ts \(public\) reads packages\/priv\/src\/index\.ts \(private\)/,
  );
});

test("a planted asset binding across the boundary fails the same way", () => {
  const { root, write } = plantedFixture();
  write("packages/pub/wrangler.toml", `[assets]\ndirectory = "../priv/src"\n`);
  const planted = runGate("check-open-core-boundaries.mjs", root);
  assert.equal(planted.status, 1, planted.stdout);
  assert.match(planted.stdout, /asset-crosses-workspace::packages\/pub\/wrangler\.toml/);
});

test("a planted file nobody placed fails, because placement is a decision", () => {
  const { root, write } = plantedFixture();
  write("packages/unplaced/thing.ts", "export const q = 1;\n");
  const planted = runGate("check-open-core-boundaries.mjs", root);
  assert.equal(planted.status, 1, planted.stdout);
  assert.match(planted.stdout, /packages\/unplaced\/thing\.ts matches no ownership rule/);
});

test("a planted forbidden dependency fails the per-workspace executable with no flags", () => {
  const { root, write } = plantedFixture();

  const clean = runGate("check-package-boundaries.mjs", root);
  assert.equal(clean.status, 0, clean.stdout);

  write(
    "packages/pub/package.json",
    JSON.stringify({ name: "@seorak/pub", dependencies: { "@seorak/priv": "*" } }),
  );
  const planted = runGate("check-package-boundaries.mjs", root);
  assert.equal(planted.status, 1, planted.stdout);
  assert.match(planted.stdout, /declares forbidden internal dependency @seorak\/priv/);
});

test("both shipped gates exit zero on this repository with no flags", () => {
  for (const script of ["check-package-boundaries.mjs", "check-open-core-boundaries.mjs"]) {
    const result = runGate(script, REPO_ROOT);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Undeclared violations \(0\)/);
  }
});
