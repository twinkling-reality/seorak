import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  COVERAGE_RUNS,
  nodeCoverageArgs,
  parseNodeCoverageRow,
  shortfalls,
  vitestCoverageArgs,
} from "./check-coverage-floors.mjs";
import {
  absenceIsExpected,
  holdsPrivateHalf,
  loadOwnership,
} from "./open-core-ownership.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { manifest: ownership } = loadOwnership(REPO_ROOT);
const holdsPrivate = holdsPrivateHalf(ownership, REPO_ROOT);

const NODE_REPORT = `
ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file       | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ src        |        |          |         | 
ℹ  routes.ts |  87.22 |    80.90 |   89.47 | 110-112 318-327
ℹ ------------------------------------------------------------
ℹ all files  |  87.22 |    80.90 |   89.47 | 
ℹ ------------------------------------------------------------
ℹ end of coverage report
`;

const EMPTY_NODE_REPORT = `
ℹ start of coverage report
ℹ ----------------------------------------------------------
ℹ file      | line % | branch % | funcs % | uncovered lines
ℹ ----------------------------------------------------------
ℹ ----------------------------------------------------------
ℹ all files | 100.00 |   100.00 |  100.00 | 
ℹ ----------------------------------------------------------
ℹ end of coverage report
`;

test("a measurement at or above every floor produces no shortfall", () => {
  assert.deepEqual(
    shortfalls(
      "packages/worker/src/routeAccess.ts",
      { lines: 100, branches: 100, functions: 100 },
      { lines: 100, branches: 100, functions: 100 },
    ),
    [],
  );
});

test("each metric is reported separately and names the file and the floor", () => {
  const problems = shortfalls(
    "packages/push/src/routes.ts",
    { lines: 84.1, branches: 79, functions: 60 },
    { lines: 85, branches: 79, functions: 87 },
  );
  assert.equal(problems.length, 2);
  assert.equal(
    problems[0],
    "packages/push/src/routes.ts: lines coverage 84.10% is below the 85% floor",
  );
  assert.match(problems[1], /functions coverage 60\.00% is below the 87% floor/);
});

test("a missing metric fails rather than passing as absent", () => {
  const problems = shortfalls(
    "packages/types/src/event-validation.ts",
    { lines: 100, branches: Number.NaN },
    { lines: 100, branches: 100, functions: 100 },
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0], /no branches coverage was reported/);
  assert.match(problems[1], /no functions coverage was reported/);
});

test("node's single-file coverage row is read back as numbers", () => {
  assert.deepEqual(parseNodeCoverageRow(NODE_REPORT, "src/routes.ts"), {
    lines: 87.22,
    branches: 80.9,
    functions: 89.47,
  });
});

test("node's empty report is not mistaken for full coverage", () => {
  assert.equal(parseNodeCoverageRow(EMPTY_NODE_REPORT, "src/routes.ts"), null);
});

test("node runs are scoped to one file and carry node's own thresholds", () => {
  const run = COVERAGE_RUNS.find((entry) => entry.id === "push-dispatch");
  const args = nodeCoverageArgs(run);
  assert.ok(args.includes("--test-coverage-include=src/routes.ts"));
  assert.ok(args.includes("--test-coverage-lines=85"));
  assert.ok(args.includes("--test-coverage-branches=79"));
  assert.ok(args.includes("--test-coverage-functions=87"));
  assert.deepEqual(args.slice(args.indexOf("--test") + 1), [
    "test/delivery-contract.test.ts",
  ]);
});

test("the vitest run includes every floored worker file", () => {
  const run = COVERAGE_RUNS.find((entry) => entry.id === "worker");
  const args = vitestCoverageArgs(run, "/tmp/example");
  assert.ok(run.tests.length > 0, "the worker coverage pass must stay focused");
  for (const test of run.tests) assert.ok(args.includes(test));
  for (const file of Object.keys(run.floors)) {
    assert.ok(
      args.includes(`--coverage.include=${file}`),
      `${file} is floored but not included in the coverage run`,
    );
  }
  assert.ok(args.includes("--coverage.reportsDirectory=/tmp/example"));
  assert.ok(args.includes("--silent=passed-only"));
});

// `packages/worker` is private and is not in the public tree, so this file's
// subject is absent there. A gate whose subject this half does not contain
// reports nothing rather than failing — the same rule the open-core map states
// for private paths it deliberately names. Without the guard it threw ENOENT
// inside `assemble-public-tree --verify`, which is the only place it runs.
test("the worker coverage provider stays on the exact Vitest version", (t) => {
  const manifestPath = resolve(REPO_ROOT, "packages/worker/package.json");
  if (!existsSync(manifestPath)) {
    t.skip("packages/worker is private and absent from this tree");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(
    manifest.devDependencies["@vitest/coverage-v8"],
    manifest.devDependencies.vitest,
    "Vitest rejects mixed versions before producing its coverage report",
  );
});

test("focused vitest runs include their owning test files", () => {
  const run = COVERAGE_RUNS.find((entry) => entry.id === "web-read-contract");
  const args = vitestCoverageArgs(run, "/tmp/example");
  for (const test of run.tests) assert.ok(args.includes(test));
});

test("every floored file exists and every floor is a real percentage", () => {
  for (const run of COVERAGE_RUNS) {
    const floors =
      run.runner === "vitest" ? run.floors : { [run.file]: run.floor };
    for (const [file, floor] of Object.entries(floors)) {
      const path = resolve(REPO_ROOT, run.workspace, file);
      // Most of these floors sit on worker, push, and mobile files, which the
      // ownership map keeps private. A tree that holds only the public half is
      // missing them by construction, and the floor is still the right floor
      // for the repository that runs it; a public file that has gone missing
      // still fails here.
      if (absenceIsExpected(ownership, `${run.workspace}/${file}`, holdsPrivate)) continue;
      assert.ok(existsSync(path), `${run.workspace}/${file} does not exist`);
      for (const metric of ["lines", "branches", "functions"]) {
        assert.equal(
          typeof floor[metric],
          "number",
          `${run.workspace}/${file} has no ${metric} floor`,
        );
        assert.ok(
          floor[metric] > 0 && floor[metric] <= 100,
          `${run.workspace}/${file} has an out-of-range ${metric} floor`,
        );
      }
    }
    for (const test of run.tests ?? []) {
      if (absenceIsExpected(ownership, `${run.workspace}/${test}`, holdsPrivate)) continue;
      assert.ok(
        existsSync(resolve(REPO_ROOT, run.workspace, test)),
        `${run.workspace}/${test} does not exist`,
      );
    }
  }
});

test("every seam named by the audit carries at least one floor", () => {
  const seams = new Set(
    COVERAGE_RUNS.flatMap((run) =>
      run.runner === "vitest"
        ? Object.values(run.floors).map((floor) => floor.seam)
        : [run.floor.seam],
    ),
  );
  assert.deepEqual(
    [...seams].sort(),
    ["auth", "ingest", "native", "push", "read"],
  );
});
