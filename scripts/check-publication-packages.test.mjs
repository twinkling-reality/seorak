import assert from "node:assert/strict";
import { test } from "node:test";

import {
  declaredArtifactTargets,
  dependencyMetadataProblems,
  hasLicenseFile,
  importableExportSubpaths,
  missingArtifactTargets,
} from "./check-publication-packages.mjs";

const TYPES_LIKE = {
  name: "@seorak/types",
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./entitlements": {
      types: "./dist/entitlements.d.ts",
      import: "./dist/entitlements.js",
    },
    "./compact-sync": {
      types: "./dist/compact-sync.d.ts",
      import: "./dist/compact-sync.js",
    },
  },
};

const COLLECTOR_LIKE = {
  name: "@seorak/collector",
  exports: {},
  bin: {
    seorak: "dist/seorak.mjs",
    "seorak-collector": "dist/daemon.mjs",
  },
};

function packed(...paths) {
  return ["package.json", "README.md", "LICENSE", ...paths];
}

test("every export condition, main, types, and bin target is collected", () => {
  const targets = declaredArtifactTargets({
    ...TYPES_LIKE,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    bin: { seorak: "dist/seorak.mjs" },
  });
  assert.deepEqual(
    targets.map(({ kind, subpath, condition, target }) => [
      kind,
      subpath,
      condition,
      target,
    ]),
    [
      ["exports", ".", "types", "dist/index.d.ts"],
      ["exports", ".", "import", "dist/index.js"],
      ["exports", "./entitlements", "types", "dist/entitlements.d.ts"],
      ["exports", "./entitlements", "import", "dist/entitlements.js"],
      ["exports", "./compact-sync", "types", "dist/compact-sync.d.ts"],
      ["exports", "./compact-sync", "import", "dist/compact-sync.js"],
      ["main", ".", "main", "dist/index.js"],
      ["types", ".", "types", "dist/index.d.ts"],
      ["bin", "seorak", "bin", "dist/seorak.mjs"],
    ],
  );
});

test("a shorthand string export is a target too", () => {
  assert.deepEqual(
    declaredArtifactTargets({ exports: { "./push": "./dist/push.js" } }).map(
      ({ subpath, condition, target }) => [subpath, condition, target],
    ),
    [["./push", "default", "dist/push.js"]],
  );
});

test("a fully built package declares nothing it does not ship", () => {
  assert.deepEqual(
    missingArtifactTargets(
      TYPES_LIKE,
      packed(
        "dist/index.js",
        "dist/index.d.ts",
        "dist/entitlements.js",
        "dist/entitlements.d.ts",
        "dist/compact-sync.js",
        "dist/compact-sync.d.ts",
      ),
    ),
    [],
  );
  assert.deepEqual(
    missingArtifactTargets(
      COLLECTOR_LIKE,
      packed("dist/seorak.mjs", "dist/daemon.mjs"),
    ),
    [],
  );
});

test("the historical defect is caught: declared subpaths that were never built", () => {
  // packages/types declared ./entitlements and ./compact-sync while the build
  // script's entry list omitted them, so both resolved to files that did not
  // exist. File counts, the dependency closure, and a publish dry run all
  // passed. This is the assertion that would not have.
  const missing = missingArtifactTargets(
    TYPES_LIKE,
    packed("dist/index.js", "dist/index.d.ts"),
  );
  assert.deepEqual(
    missing.map(({ subpath, condition }) => `${subpath} (${condition})`),
    [
      "./entitlements (types)",
      "./entitlements (import)",
      "./compact-sync (types)",
      "./compact-sync (import)",
    ],
  );
});

test("a missing type declaration fails even when the runtime file ships", () => {
  const missing = missingArtifactTargets(TYPES_LIKE, [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/entitlements.js",
    "dist/compact-sync.js",
    "dist/compact-sync.d.ts",
  ]);
  assert.deepEqual(missing.map(({ target }) => target), [
    "dist/entitlements.d.ts",
  ]);
});

test("a bin command pointing at an unbuilt file fails", () => {
  assert.deepEqual(
    missingArtifactTargets(COLLECTOR_LIKE, packed("dist/seorak.mjs")).map(
      ({ kind, subpath, target }) => [kind, subpath, target],
    ),
    [["bin", "seorak-collector", "dist/daemon.mjs"]],
  );
});

test("importable subpaths are derived, and peer-gated ones can be skipped", () => {
  assert.deepEqual(
    importableExportSubpaths({
      exports: {
        ...TYPES_LIKE.exports,
        "./push": { types: "./dist/push.d.ts", import: "./dist/push.js" },
      },
    }),
    ["", "/entitlements", "/compact-sync", "/push"],
  );
  assert.deepEqual(
    importableExportSubpaths(
      {
        exports: {
          ...TYPES_LIKE.exports,
          "./push": { types: "./dist/push.d.ts", import: "./dist/push.js" },
        },
      },
      { skip: ["./push"] },
    ),
    ["", "/entitlements", "/compact-sync"],
  );
});

test("a types-only export subpath is not treated as importable", () => {
  assert.deepEqual(
    importableExportSubpaths({
      exports: { "./shapes": { types: "./dist/shapes.d.ts" } },
    }),
    [],
  );
});

test("a wildcard export resolves when something ships under it, and not otherwise", () => {
  const manifest = { exports: { "./internal/*": "./dist/internal/*.js" } };
  const [entry] = declaredArtifactTargets(manifest);
  assert.equal(entry.pattern, true);
  // This used to be exempt: a pattern cannot be resolved to ONE file, so it was
  // reported and skipped. That is not the question the gate asks. `./dist/*`
  // over an empty `dist` promises a consumer a subpath that resolves to nothing,
  // which is the same defect the non-wildcard half already catches.
  assert.deepEqual(
    missingArtifactTargets(manifest, packed()).map(({ target }) => target),
    ["dist/internal/*.js"],
  );
  assert.deepEqual(
    missingArtifactTargets(manifest, packed("dist/internal/thing.js")),
    [],
  );
});

test("the dashboard's `./dist/*` is satisfied by any file under dist, at any depth", () => {
  // The artifact is content-hashed chunks under nested directories, so the
  // wildcard has to span separators exactly as Node's own resolver does.
  const manifest = {
    exports: { "./package.json": "./package.json", "./dist/*": "./dist/*" },
  };
  assert.deepEqual(
    missingArtifactTargets(manifest, [
      "package.json",
      "dist/assets/stack/rust.svg",
    ]),
    [],
  );
  assert.deepEqual(
    missingArtifactTargets(manifest, ["package.json"]).map(({ target }) => target),
    ["dist/*"],
  );
});

test("the real manifests declare only targets the gate can resolve", async () => {
  const types = (
    await import("../packages/types/package.json", { with: { type: "json" } })
  ).default;
  const collector = (
    await import("../packages/collector/package.json", {
      with: { type: "json" },
    })
  ).default;

  const dashboard = (
    await import("../packages/dashboard/package.json", {
      with: { type: "json" },
    })
  ).default;

  for (const manifest of [types, collector, dashboard]) {
    const targets = declaredArtifactTargets(manifest);
    assert.ok(targets.length > 0, `${manifest.name} declares no targets`);
  }
  // The three subpaths whose targets were declared but unbuilt must now be
  // part of what the gate imports from a clean install.
  const importable = importableExportSubpaths(types, { skip: ["./push"] });
  for (const subpath of ["/entitlements", "/compact-sync", "/data-plane"]) {
    assert.ok(
      importable.includes(subpath),
      `${subpath} is not covered by the publication gate`,
    );
  }

  // The dashboard is assets. The ONLY subpath a consumer resolves is its own
  // manifest, which is the resolution contract ADR 005 decision 3 specifies:
  // resolve `@seorak/dashboard/package.json` and derive the asset root from
  // where it landed. There is no module entry, because there is no module.
  assert.deepEqual(importableExportSubpaths(dashboard), ["/package.json"]);
  assert.equal(dashboard.main, undefined);

  // The pin ADR 005 decision 3 requires is exact and current. A caret here is
  // how the account-free product becomes a sign-in wall.
  assert.equal(collector.dependencies["@seorak/dashboard"], dashboard.version);
  assert.equal(
    collector.dependencies["@modelcontextprotocol/server"],
    "2.0.0",
  );
  assert.equal(
    collector.devDependencies["@modelcontextprotocol/client"],
    "2.0.0",
  );
  assert.equal(collector.dependencies["@modelcontextprotocol/client"], undefined);
});

test("the official MCP production closure has exact compatible metadata", () => {
  const server = {
    name: "@modelcontextprotocol/server",
    version: "2.0.0",
    license: "MIT",
    engines: { node: ">=20" },
  };
  const expected = {
    name: "@modelcontextprotocol/server",
    version: "2.0.0",
    license: "MIT",
    nodeEngine: ">=20",
  };
  assert.deepEqual(dependencyMetadataProblems(server, expected), []);
  assert.deepEqual(
    dependencyMetadataProblems(
      { ...server, version: "2.0.1", license: "Apache-2.0" },
      expected,
    ),
    [
      "version is 2.0.1, expected 2.0.0",
      "license is Apache-2.0, expected MIT",
    ],
  );
  assert.deepEqual(
    dependencyMetadataProblems(
      { ...server, engines: { node: ">=22" } },
      expected,
    ),
    ["engines.node is >=22, expected >=20"],
  );
  assert.deepEqual(
    dependencyMetadataProblems(
      { name: "zod", version: "4.3.6", license: "MIT" },
      { name: "zod", versionPattern: /^4\./, license: "MIT" },
    ),
    [],
  );
  assert.deepEqual(
    dependencyMetadataProblems(
      { name: "zod", version: "5.0.0", license: "MIT" },
      { name: "zod", versionPattern: /^4\./, license: "MIT" },
    ),
    ["version is 5.0.0, expected /^4\\./"],
  );
  assert.equal(hasLicenseFile(["package.json", "LICENSE"]), true);
  assert.equal(hasLicenseFile(["package.json", "License.md"]), true);
  assert.equal(hasLicenseFile(["package.json", "README.md"]), false);
});
