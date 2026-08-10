/**
 * The gate coverage guard's own suite.
 *
 * It sits beside the guard rather than inside `gate-plan.test.mjs` for the same
 * reason the guard sits beside the map it reads: the guard is public and the
 * plan is not, so a public repository that shipped the guard without this file
 * would carry a check nobody had ever seen fail. The two bugs named below are
 * the ones the public core's inline version still had, and each has a test here
 * that fails against that version.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  checkGateCoverage,
  compareCoverage,
  loadSources,
  scriptNames,
  workspaceScriptNames,
} from "./check-gate-coverage.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const scratch = [];

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/** A throwaway tree holding only the two files the comparison is derived from. */
function fixture({ test: testScript, scripts = {}, workflow }) {
  const root = mkdtempSync(join(tmpdir(), "seorak-gate-coverage-"));
  scratch.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: testScript, ...scripts } }),
  );
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow);
  return root;
}

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@abc
      - run: npm ci
      # a comment between steps
      - name: Alpha
        run: |
          npm run alpha:test
          npm run alpha:check
      - name: Costly thing
        run: npm run costly:check
`;

describe("reading names out of a shell fragment", () => {
  it("does not stop at a digit, which is how browser-e2e became browser-e", () => {
    assert.deepEqual([...scriptNames("npm run browser-e2e")], ["browser-e2e"]);
  });

  it("keeps colons, dashes and underscores", () => {
    assert.deepEqual(
      [...scriptNames("npm run a:b && npm run c-d && npm run e_f")],
      ["a:b", "c-d", "e_f"],
    );
  });

  it("reads workspace-scoped invocations as their own thing", () => {
    const text = "npm run gate:release --workspace @seorak/worker";
    assert.deepEqual([...workspaceScriptNames(text)], ["gate:release --workspace @seorak/worker"]);
  });
});

describe("coverage between the two sources", () => {
  it("reports a gate the test script runs and no step does", () => {
    const root = fixture({
      test: "npm run alpha:test && npm run orphan:check",
      workflow: WORKFLOW,
    });
    assert.deepEqual(compareCoverage(loadSources(root)).uncovered, ["orphan:check"]);
  });

  it("reports a step running a script the manifest does not define", () => {
    const root = fixture({
      test: "npm run alpha:test",
      scripts: { "alpha:test": "x" },
      workflow: WORKFLOW,
    });
    const { invented } = compareCoverage(loadSources(root));
    assert.deepEqual(invented.sort(), ["alpha:check", "costly:check"]);
  });

  it("does not call a workspace-scoped script invented", () => {
    const workflow = WORKFLOW.replace(
      "npm run costly:check",
      "npm run gate:release --workspace @seorak/worker",
    );
    const root = fixture({
      test: "npm run alpha:test",
      scripts: { "alpha:test": "x", "alpha:check": "x" },
      workflow,
    });
    assert.deepEqual(compareCoverage(loadSources(root)).invented, []);
  });

  it("fails, rather than reports, when a gate is uncovered", () => {
    const root = fixture({
      test: "npm run alpha:test && npm run alpha:check && npm run orphan:check",
      scripts: { "alpha:test": "x", "alpha:check": "x", "costly:check": "x", "orphan:check": "x" },
      workflow: WORKFLOW,
    });
    const { problems } = checkGateCoverage(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /orphan:check/);
  });

  it("holds this repository to it", () => {
    const { problems } = checkGateCoverage(REPO_ROOT);
    assert.deepEqual(problems, []);
  });
});
