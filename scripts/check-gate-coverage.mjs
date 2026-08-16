#!/usr/bin/env node

/**
 * Do the root `test` script and `.github/workflows/ci.yml` name the same gates?
 *
 * The public core's workflow already carries this comparison, inline, as the
 * first thing it runs, and its comment says why: this repository has repeatedly
 * shipped a gate reachable only through a script CI does not run, and every one
 * of them stayed green while covering nothing. The private side had the same
 * defect in larger numbers — measured 2026-08-07, ELEVEN gates were named by the
 * root test script and by no step of the private workflow, including the gate
 * that boots each Worker's runtime and the one that resolves every public
 * markdown link. They are wired into the workflow now, and this is what fails
 * when a twelfth appears.
 *
 * So the private side gets the same guard, as a file rather than a second
 * hand-written list. Being a file buys three things the inline version cannot
 * have: a test, a name pattern that does not stop at a digit, and an
 * understanding of `--workspace`.
 *
 *   THE DIGIT. The inline guard matches `npm run ([a-z:-]+)`, which reads
 *   `browser-e2e` as `browser-e`. A name the guard cannot spell is a name it
 *   cannot compare, and `browser-e2e` is a whole job.
 *
 *   THE WORKSPACE. The private workflow runs five workspace-scoped scripts
 *   (`gate:bindings`, `gate:release`, `gate:deploy-dry-run` and two more) that
 *   are not root scripts and never will be. The inline guard would report every
 *   one of them as invented and fail on correct input.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 * ---------------------------------------------------------------------------
 *
 * UNCOVERED. A gate the root `test` script runs and no workflow step does. This
 * is the defect. It fails.
 *
 * INVENTED. A workflow step running `npm run X` where X is neither a root script
 * nor workspace-scoped. This is the failure the public guard was written after:
 * its first draft ran `coverage:check`, which that manifest does not define, and
 * the step failed with "Missing script" the first time anybody ran it. It fails.
 *
 * WORKFLOW-ONLY is an exact set of build/release commands with a reason to stay
 * outside `npm test`. Every other extra fails. Without that reverse check,
 * deleting a gate from the root test script merely reclassified it as EXTRA and
 * the guard stayed green.
 *
 * THERE IS DELIBERATELY NO ACCEPTANCE FILE, and the eleven are why. Six sibling
 * gates in this repository carry one, so the obvious move was to record the
 * eleven with a reason each. Try to write those reasons and they do not exist:
 * every one reduces to "nobody added the step", which is a defect and not an
 * acceptance. An acceptance file here would have turned eleven wiring defects
 * into eleven permanent entries, and made the next eleven survivable too.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./open-core-ownership.mjs";

/**
 * ---------------------------------------------------------------------------
 * WHY THE READING LIVES HERE AND NOT IN `gate-plan.mjs`
 * ---------------------------------------------------------------------------
 *
 * These four functions used to be imported from `gate-plan.mjs`, which is the
 * PRIVATE local gate runner: its tier table, its pre-push classification, and
 * its step names are this repository's, and none of that belongs in the public
 * core. A public file may not import a private one, so a guard that shipped
 * public while importing the runner would not resolve in the assembled tree.
 *
 * The comparison itself is the part both repositories need, so it is the part
 * that moved. `gate-plan.mjs` imports it back from here and re-exports it, which
 * keeps one implementation rather than the second copy this whole file exists to
 * argue against. The private runner still owns everything above the comparison:
 * `parseWorkflow`, `buildPlan`, the tiers, and the skip reasons.
 */

export const WORKFLOW_PATH = ".github/workflows/ci.yml";
export const MANIFEST_PATH = "package.json";

const NAME_PATTERN = /npm run ([A-Za-z0-9:_-]+)/g;

const WORKFLOW_ONLY_ROOT_SCRIPTS = new Set([
  "typecheck",
  "patches:check",
  "hosted-rehearsals-prep:test",
  "build:web",
  // The public half's ci.yml builds the dashboard where this half builds the
  // site, for the same reason `build:web` is here: producing an artifact is not
  // a gate, and requiring it in the root `test` script would make every local
  // test run build a bundle. Only the PUBLIC tree trips this — the private
  // workflow has no `build:dashboard` step — so it fails nowhere except inside
  // `assemble-public-tree --verify`, which is the one place nobody runs by
  // habit. It has been red there since before the open-core split shipped.
  "build:dashboard",
  "mobile-release:test",
  "mobile-release:check",
  "mobile-native-release:check",
  "browser-e2e",
]);

/**
 * Script names a shell fragment invokes through `npm run`. The public core's
 * inline guard used `[a-z:-]+`, which stops at a digit and reads `browser-e2e`
 * as `browser-e`; a name that cannot be spelled cannot be compared.
 */
export function scriptNames(text) {
  return new Set([...text.matchAll(NAME_PATTERN)].map((match) => match[1]));
}

/**
 * Workspace-scoped invocations, as `name --workspace pkg`. These are not root
 * scripts and must not be reported as invented ones.
 */
export function workspaceScriptNames(text) {
  const pattern = /npm run ([A-Za-z0-9:_-]+) --workspace (\S+)/g;
  return new Set([...text.matchAll(pattern)].map((match) => `${match[1]} --workspace ${match[2]}`));
}

export function loadSources(repositoryRoot = REPO_ROOT) {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, MANIFEST_PATH), "utf8"));
  const workflow = readFileSync(resolve(repositoryRoot, WORKFLOW_PATH), "utf8");
  return { manifest, workflow };
}

/**
 * What each source names and the other does not. `uncovered` is the answer that
 * matters: a gate the root test script runs and no workflow step does is a gate
 * that would not have caught anything even on the day CI worked.
 */
export function compareCoverage({ manifest, workflow }) {
  const declared = scriptNames(manifest.scripts.test ?? "");
  const run = scriptNames(workflow);
  const scoped = workspaceScriptNames(workflow);
  const scopedNames = new Set([...scoped].map((entry) => entry.split(" ")[0]));

  const uncovered = [...declared].filter((name) => !run.has(name));
  const extra = [...run].filter((name) => !declared.has(name));
  const invented = [...run].filter(
    (name) => manifest.scripts[name] === undefined && !scopedNames.has(name),
  );
  const unexpectedExtra = extra.filter(
    (name) => manifest.scripts[name] !== undefined &&
      !WORKFLOW_ONLY_ROOT_SCRIPTS.has(name),
  );

  return { declared, run, uncovered, extra, invented, unexpectedExtra };
}

export function checkGateCoverage(repositoryRoot = REPO_ROOT) {
  const { uncovered, extra, invented, unexpectedExtra, declared } =
    compareCoverage(loadSources(repositoryRoot));

  const problems = [
    ...uncovered.map(
      (name) => `the root test script runs ${name} and no step of ${WORKFLOW_PATH} does`,
    ),
    ...invented.map(
      (name) => `${WORKFLOW_PATH} runs ${name}, which ${MANIFEST_PATH} does not define`,
    ),
    ...unexpectedExtra.map(
      (name) => `${WORKFLOW_PATH} runs ${name}, but the root test script no longer does`,
    ),
  ];

  const notes = [
    `Covered ${declared.size} gates named by the root test script, and invented none.`,
  ];
  if (extra.length > 0) {
    notes.push(
      `${extra.length} scripts run by the workflow and not by the root test script, which is allowed: ${extra.join(", ")}.`,
    );
  }

  return { problems, notes };
}

export function formatReport({ problems, notes }) {
  const lines = [`Gate coverage. Sources: ${MANIFEST_PATH} test script, ${WORKFLOW_PATH}.`];
  for (const note of notes) lines.push(`  ${note}`);
  if (problems.length === 0) {
    lines.push("", "No problems.");
    return lines.join("\n");
  }
  lines.push("", `Problems (${problems.length}):`);
  for (const problem of problems) lines.push(`  ! ${problem}`);
  return lines.join("\n");
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const repositoryRoot = rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT;
  const result = checkGateCoverage(repositoryRoot);
  console.log(formatReport(result));
  process.exitCode = result.problems.length > 0 ? 1 : 0;
}
