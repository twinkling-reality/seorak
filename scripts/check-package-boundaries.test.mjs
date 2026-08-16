import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  analyzeImports,
  boundaryProblemsForPolicy,
  importSpecifiers,
} from "./check-package-boundaries.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

/**
 * The workspace identities and visibility rules the real gate reads from
 * `docs/reference/open-core-ownership.json`. Fixtures carry a copy so a policy
 * unit test needs no manifest on disk; `the shipped ownership map drives every
 * workspace policy` below is what proves the real one still parses.
 */
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

const WORKSPACE_PACKAGES = new Map([
  ["@seorak/types", "public"],
  ["seorak", "public"],
  ["@seorak/web", "mixed"],
  ["@seorak/worker", "private"],
  ["seorak-app", "private"],
]);

function fixture({
  name,
  exports: exportsField,
  dependencies = {},
  optionalDependencies = {},
  peerDependencies = {},
  devDependencies = {},
  files = { "src/index.ts": "" },
  packageRoot = "packages/collector",
  sourceRoots = [{ path: "src", mode: "production" }],
  allowedInternalPackages = new Set(["@seorak/types"]),
  visibility = "public",
  moduleLoaders = "forbidden",
  developmentMatchers = [],
  workspacePackages = WORKSPACE_PACKAGES,
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-boundary-"));
  temporaryRoots.push(root);
  const target = resolve(root, packageRoot);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    resolve(target, "package.json"),
    JSON.stringify({
      name:
        name ??
        (packageRoot === "packages/types"
          ? "@seorak/types"
          : "@seorak/collector"),
      exports:
        exportsField === undefined
          ? packageRoot === "packages/types"
            ? {
                ".": "./dist/index.js",
                "./event-validation": "./dist/event-validation.js",
              }
            : {}
          : exportsField,
      dependencies,
      optionalDependencies,
      peerDependencies,
      devDependencies,
    }),
  );
  for (const [path, source] of Object.entries(files)) {
    const destination = resolve(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
  return {
    root,
    policy: {
      packageRoot,
      packageName:
        packageRoot === "packages/types"
          ? "@seorak/types"
          : "@seorak/collector",
      sourceRoots,
      allowedInternalPackages,
      visibility,
      moduleLoaders,
      developmentMatchers,
      workspacePackages,
      visibilities: VISIBILITIES,
    },
  };
}

test("the parser finds every static JavaScript and TypeScript module edge", () => {
  assert.deepEqual(
    importSpecifiers(`
      import x from "one";
      export { y } from "two";
      const a = import("three");
      const b = require("four");
      type Five = import("five").Value;
      import Six = require("six");
      const seven = import(\`seven\`);
    `),
    ["one", "two", "three", "four", "five", "six", "seven"],
  );
});

test("computed module loads fail closed through createRequire aliases", () => {
  const analysis = analyzeImports(`
    import { createRequire as makeRequire } from "node:module";
    const load = makeRequire(import.meta.url);
    const packageName = "@seorak/worker";
    void import(packageName);
    void import(\`@seorak/\${packageName}\`);
    load(packageName);
    require(packageName);
  `);
  assert.deepEqual(analysis.specifiers, ["node:module"]);
  assert.deepEqual(analysis.problems, [
    "contains a non-literal dynamic import",
    "contains a non-literal dynamic import",
    "contains a non-literal load module load",
    "contains a non-literal require module load",
  ]);
});

test("collector production accepts its declared boundary and Node builtins", () => {
  const input = fixture({
    dependencies: { "@seorak/types": "*", zod: "1.0.0" },
    files: {
      "src/index.ts": `
        import fs from "node:fs";
        import { x } from "@seorak/types/events";
        import { z } from "zod";
        import { local } from "./local.ts";
      `,
    },
  });
  assert.deepEqual(boundaryProblemsForPolicy(input.root, input.policy), []);
});

test("prefix-only Node builtins are stable across supported Node versions", () => {
  const input = fixture({
    files: {
      "src/index.ts": `import "node:sqlite";`,
      "test/index.test.ts": `import "node:test";`,
    },
    sourceRoots: [
      { path: "src", mode: "production" },
      { path: "test", mode: "development" },
    ],
  });
  assert.deepEqual(boundaryProblemsForPolicy(input.root, input.policy), []);

  const invalid = fixture({
    files: { "src/index.ts": `import "node:not-a-real-builtin";` },
  });
  assert.match(
    boundaryProblemsForPolicy(invalid.root, invalid.policy)[0],
    /imports undeclared production dependency node:not-a-real-builtin/,
  );
});

test("optional and peer dependencies are production boundaries", () => {
  const input = fixture({
    optionalDependencies: { optional: "1.0.0" },
    peerDependencies: { "@mobile-surfaces/tokens": "7.1.2" },
    files: {
      "src/index.ts": `
        import "optional";
        import { tokenForwarderRequestSchema } from "@mobile-surfaces/tokens/wire";
      `,
    },
  });
  assert.deepEqual(boundaryProblemsForPolicy(input.root, input.policy), []);
});

test("development dependencies cannot leak into production roots", () => {
  const input = fixture({
    devDependencies: { vitest: "4.1.8" },
    files: {
      "src/index.ts": `import "vitest";`,
      "test/index.test.ts": `import "vitest";`,
    },
    sourceRoots: [
      { path: "src", mode: "production" },
      { path: "test", mode: "development" },
    ],
  });
  const problems = boundaryProblemsForPolicy(input.root, input.policy);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /src\/index\.ts imports undeclared production dependency vitest/);
});

test("test and script roots enforce closed packages and declarations", () => {
  const input = fixture({
    files: {
      "test/index.test.ts": `import "@seorak/worker";`,
      "scripts/build.mjs": `import "left-pad";`,
    },
    sourceRoots: [
      { path: "test", mode: "development" },
      { path: "scripts", mode: "development" },
    ],
  });
  const problems = boundaryProblemsForPolicy(input.root, input.policy);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((problem) => /forbidden package boundary/.test(problem)));
  assert.ok(
    problems.some((problem) =>
      /imports undeclared development dependency left-pad/.test(problem),
    ),
  );
});

test("package self-references are valid development imports", () => {
  const input = fixture({
    packageRoot: "packages/types",
    allowedInternalPackages: new Set(),
    files: {
      "test/index.test.ts": `
        import "@seorak/types";
        import "@seorak/types/event-validation";
      `,
    },
    sourceRoots: [{ path: "test", mode: "development" }],
  });
  assert.deepEqual(boundaryProblemsForPolicy(input.root, input.policy), []);
});

test("collector rejects closed packages, undeclared imports, and root escapes", () => {
  const input = fixture({
    files: {
      "src/index.ts": `
        import "@seorak/worker";
        import "left-pad";
        import "../../../apps/mobile/App.tsx";
      `,
    },
  });
  const problems = boundaryProblemsForPolicy(input.root, input.policy);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /forbidden package boundary/);
  assert.match(problems[1], /undeclared production dependency/);
  assert.match(problems[2], /imports outside/);
});

test("relative imports cannot traverse node_modules or symbolic links", () => {
  const nodeModules = fixture({
    files: {
      "src/index.ts":
        `import "../node_modules/@seorak/worker/index.js";`,
    },
  });
  assert.match(
    boundaryProblemsForPolicy(nodeModules.root, nodeModules.policy)[0],
    /imports through package-local node_modules/,
  );

  const links = fixture({
    files: {
      "src/index.ts": "",
    },
  });
  const externalSource = resolve(
    links.root,
    "packages/worker/src",
  );
  mkdirSync(externalSource, { recursive: true });
  writeFileSync(resolve(externalSource, "index.ts"), "");
  const sourceRoot = resolve(
    links.root,
    "packages/collector/src",
  );
  symlinkSync(
    resolve(externalSource, "index.ts"),
    resolve(sourceRoot, "linked-worker.ts"),
  );
  symlinkSync(
    externalSource,
    resolve(sourceRoot, "linked-worker"),
  );
  const problems = boundaryProblemsForPolicy(links.root, links.policy);
  assert.equal(problems.length, 2);
  assert.ok(
    problems.every((problem) => /is a symbolic link/.test(problem)),
  );
});

test("import types carry the same closed and declared boundaries", () => {
  const input = fixture({
    files: {
      "src/index.ts": `
        type Worker = import("@seorak/worker").WorkerEnv;
        type Padding = import("left-pad").Padding;
      `,
    },
  });
  const problems = boundaryProblemsForPolicy(input.root, input.policy);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((problem) => /forbidden package boundary/.test(problem)));
  assert.ok(
    problems.some((problem) =>
      /undeclared production dependency left-pad/.test(problem),
    ),
  );
});

test("createRequire aliases cannot bypass a forbidden package edge", () => {
  for (const source of [
    `
      import * as nodeModule from "module";
      const load = nodeModule.createRequire(import.meta.url);
      load("@seorak/worker");
    `,
    `
      import nodeModule from "node:module";
      const load = nodeModule.createRequire(import.meta.url);
      load("@seorak/worker");
    `,
    `
      import { default as nodeModule } from "node:module";
      nodeModule.createRequire(import.meta.url)("@seorak/worker");
    `,
    `
      import nodeModule = require("node:module");
      nodeModule.createRequire(import.meta.url)("@seorak/worker");
    `,
    `
      const nodeModule = await import("node:module");
      nodeModule.createRequire(import.meta.url)("@seorak/worker");
    `,
    `
      const { createRequire: makeRequire } = require("node:module");
      const load = makeRequire(import.meta.url);
      load("@seorak/worker");
    `,
    `
      const makeRequire = require("node:module").createRequire;
      makeRequire(import.meta.url)("@seorak/worker");
    `,
    `
      import * as nodeModule from "node:module";
      const alias = nodeModule;
      const { createRequire: makeRequire } = alias;
      makeRequire(import.meta.url)("@seorak/worker");
    `,
    `
      import * as nodeModule from "node:module";
      const makeRequire = nodeModule["createRequire"];
      makeRequire(import.meta.url)("@seorak/worker");
    `,
  ]) {
    const input = fixture({ files: { "src/index.ts": source } });
    assert.ok(
      boundaryProblemsForPolicy(input.root, input.policy).some((problem) =>
        /forbidden package boundary/.test(problem),
      ),
    );
  }
});

test("every manifest dependency section enforces the internal boundary", () => {
  for (const section of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ]) {
    const input = fixture({
      [section]: { "@seorak/worker": "*" },
    });
    assert.match(
      boundaryProblemsForPolicy(input.root, input.policy)[0],
      new RegExp(`${section} declares forbidden internal dependency`),
    );
  }
});

test("invalid syntax is not treated as an import-free file", () => {
  const input = fixture({
    files: { "src/index.ts": `import { from "left-pad";` },
  });
  assert.match(
    boundaryProblemsForPolicy(input.root, input.policy)[0],
    /contains invalid syntax/,
  );
});

test("non-literal TypeScript import-equals loads fail closed", () => {
  const analysis = analyzeImports(`import Package = require(packageName);`);
  assert.deepEqual(analysis.specifiers, []);
  assert.deepEqual(analysis.problems, [
    "contains a non-literal TypeScript import-equals module load",
  ]);
});

test("package-level development configs are inside the boundary", () => {
  const input = fixture({
    files: {
      "src/index.ts": "",
      "vitest.config.ts": `import "@seorak/worker";`,
    },
    sourceRoots: [
      { path: "src", mode: "production" },
      { path: "vitest.config.ts", mode: "development" },
    ],
  });
  assert.match(
    boundaryProblemsForPolicy(input.root, input.policy)[0],
    /forbidden package boundary/,
  );
});

test("manifest aliases cannot hide a forbidden internal package", () => {
  for (const specifier of [
    "npm:@seorak/worker",
    "npm:@seorak/worker@1.0.0",
    "workspace:@seorak/worker@*",
  ]) {
    const input = fixture({
      dependencies: { "worker-alias": specifier },
      files: { "src/index.ts": `import "worker-alias";` },
    });
    assert.match(
      boundaryProblemsForPolicy(input.root, input.policy)[0],
      /forbidden internal dependency @seorak\/worker as worker-alias/,
    );
  }

  for (const specifier of ["file:../worker", "workspace:../worker"]) {
    const input = fixture({
      dependencies: { "worker-alias": specifier },
      files: { "src/index.ts": `import "worker-alias";` },
    });
    const workerManifest = resolve(
      input.root,
      "packages/worker/package.json",
    );
    mkdirSync(dirname(workerManifest), { recursive: true });
    writeFileSync(
      workerManifest,
      JSON.stringify({ name: "@seorak/worker" }),
    );
    assert.match(
      boundaryProblemsForPolicy(input.root, input.policy)[0],
      /forbidden internal dependency @seorak\/worker as worker-alias/,
    );
  }

  const unverifiableArchive = fixture({
    dependencies: { "worker-alias": "file:../worker.tgz" },
  });
  assert.match(
    boundaryProblemsForPolicy(
      unverifiableArchive.root,
      unverifiableArchive.policy,
    )[0],
    /cannot verify local dependency target file:\.\.\/worker\.tgz/,
  );
});

test("boundary identity and exported self-reference are immutable", () => {
  const renamed = fixture({
    name: "@seorak/worker",
    files: { "src/index.ts": `import "@seorak/worker";` },
  });
  assert.match(
    boundaryProblemsForPolicy(renamed.root, renamed.policy)[0],
    /does not match boundary identity/,
  );

  const privateSubpath = fixture({
    packageRoot: "packages/types",
    allowedInternalPackages: new Set(),
    files: {
      "test/index.test.ts": `import "@seorak/types/private";`,
    },
    sourceRoots: [{ path: "test", mode: "development" }],
  });
  assert.match(
    boundaryProblemsForPolicy(privateSubpath.root, privateSubpath.policy)[0],
    /unexported self-reference/,
  );

  for (const exportsField of [
    null,
    {
      ".": "./index.js",
      "./*": "./*.js",
      "./private": null,
    },
  ]) {
    const disabled = fixture({
      packageRoot: "packages/types",
      allowedInternalPackages: new Set(),
      exports: exportsField,
      files: {
        "test/index.test.ts":
          exportsField === null
            ? `import "@seorak/types";`
            : `import "@seorak/types/private";`,
      },
      sourceRoots: [{ path: "test", mode: "development" }],
    });
    assert.match(
      boundaryProblemsForPolicy(disabled.root, disabled.policy)[0],
      /unexported self-reference/,
    );
  }
});

test("shadowing require is an explicit fail-closed policy violation", () => {
  const input = fixture({
    files: {
      "src/index.ts": `function load(require, name) { require(name); }`,
    },
  });
  assert.deepEqual(boundaryProblemsForPolicy(input.root, input.policy), [
    "packages/collector/src/index.ts declares the reserved module-loader binding require",
  ]);
});

test("computed node module access fails closed before it can hide a loader", () => {
  const analysis = analyzeImports(`
    import * as nodeModule from "node:module";
    const member = "createRequire";
    const makeRequire = nodeModule[member];
  `);
  assert.ok(
    analysis.problems.includes("contains computed node:module member access"),
  );
});

test("a workspace whose name carries no @seorak/ prefix is still internal", () => {
  // apps/mobile publishes as `seorak-app`. The old literal `@seorak/` prefix
  // test could not see an edge into it at all, which is why workspace identity
  // is now a declared map.
  const dependency = fixture({
    dependencies: { "seorak-app": "*" },
    files: { "src/index.ts": "" },
  });
  assert.match(
    boundaryProblemsForPolicy(dependency.root, dependency.policy)[0],
    /declares forbidden internal dependency seorak-app/,
  );

  const imported = fixture({
    files: { "src/index.ts": `import "seorak-app/lib/thing.js";` },
  });
  assert.match(
    boundaryProblemsForPolicy(imported.root, imported.policy)[0],
    /crosses a forbidden package boundary/,
  );
});

test("visibility decides what an allowed internal package may still not be", () => {
  // A workspace can be allowed to reach another one by CLAUDE.md rule 1 and
  // still be forbidden to reach it by ADR 005: the public core never reads the
  // private cloud, whatever the per-package allowlist says.
  const dependency = fixture({
    dependencies: { "@seorak/worker": "*" },
    allowedInternalPackages: new Set(["@seorak/worker"]),
  });
  assert.match(
    boundaryProblemsForPolicy(dependency.root, dependency.policy)[0],
    /declares private dependency @seorak\/worker, which a public workspace may not carry/,
  );

  const imported = fixture({
    dependencies: { "@seorak/worker": "*" },
    allowedInternalPackages: new Set(["@seorak/worker"]),
    files: { "src/index.ts": `import "@seorak/worker";` },
  });
  const problems = boundaryProblemsForPolicy(imported.root, imported.policy);
  assert.ok(
    problems.some((problem) =>
      /imports private package @seorak\/worker, which a public workspace may not read/.test(
        problem,
      ),
    ),
  );

  // The legal direction stays legal.
  const legal = fixture({
    visibility: "private",
    dependencies: { "@seorak/types": "*" },
    files: { "src/index.ts": `import "@seorak/types";` },
  });
  assert.deepEqual(boundaryProblemsForPolicy(legal.root, legal.policy), []);
});

test("the reserved require binding is per-workspace policy, not a global rule", () => {
  const source = {
    "src/index.ts": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const wrangler = require("wrangler");
    `,
  };
  const strict = fixture({ files: source, devDependencies: { wrangler: "*" } });
  assert.ok(
    boundaryProblemsForPolicy(strict.root, strict.policy).some((problem) =>
      /declares the reserved module-loader binding require/.test(problem),
    ),
  );

  // A private deploy script may use createRequire; what must not change is that
  // the specifier it loads is still resolved and still checked.
  const permissive = fixture({
    files: source,
    moduleLoaders: "allowed",
    visibility: "private",
  });
  assert.deepEqual(boundaryProblemsForPolicy(permissive.root, permissive.policy), [
    "packages/collector/src/index.ts imports undeclared production dependency wrangler",
  ]);
});

test("a co-located test is development code wherever it sits", () => {
  const files = {
    "src/thing.ts": "export const a = 1;",
    "src/thing.test.ts": `import "vitest";`,
  };
  const colocated = fixture({ files, devDependencies: { vitest: "*" } });
  assert.deepEqual(boundaryProblemsForPolicy(colocated.root, colocated.policy), [
    "packages/collector/src/thing.test.ts imports undeclared production dependency vitest",
  ]);

  const recognised = fixture({
    files,
    devDependencies: { vitest: "*" },
    developmentMatchers: [/^packages\/collector\/src\/.*\.test\.ts$/],
  });
  assert.deepEqual(boundaryProblemsForPolicy(recognised.root, recognised.policy), []);

  // The downgrade reaches test files only. Production source keeps the tighter
  // rule, so this is not a way to launder a development dependency.
  const production = fixture({
    files: { "src/thing.ts": `import "vitest";` },
    devDependencies: { vitest: "*" },
    developmentMatchers: [/^packages\/collector\/src\/.*\.test\.ts$/],
  });
  assert.deepEqual(boundaryProblemsForPolicy(production.root, production.policy), [
    "packages/collector/src/thing.ts imports undeclared production dependency vitest",
  ]);
});
