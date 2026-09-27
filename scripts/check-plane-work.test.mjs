/**
 * The gate is only worth its runtime if it FAILS on the thing it claims to
 * catch, so every rule here is proved by planting a violation into the real
 * source and watching the gate find it, then proving the unmutated source is
 * clean. A gate tested against a hand-written fixture proves that the fixture
 * is shaped the way the gate expects, which is not the same claim.
 *
 * Two of these tests exist because the gate was wrong in exactly that way while
 * it was being written:
 *
 *   - `acceptsProperty` originally descended only the parameter's type node. It
 *     found every `rowBudget`, because those are written inline as an
 *     intersection, and no `rangeDays`, because that is a member of the named
 *     `LocalOverviewOptions`. Rule 1 reported clean on the one inline fold in
 *     the tree. `derives the window and budget classification` is what would
 *     have caught it.
 *   - guard detection has to descend the WHOLE handler, because three of the
 *     five ticks are written `() => void (async () => { ... })()` and the guard
 *     sits two function bodies down. `sees the guard through the nested async
 *     shape` is what holds that.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  builderSet,
  checkPlaneWork,
  daemonTicks,
  staleTickDeclarations,
} from "./check-plane-work.mjs";
import { REPO_ROOT } from "./open-core-ownership.mjs";

const SOURCE_ROOT = resolve(REPO_ROOT, "packages/collector/src");

/** A `read` that serves one module mutated and every other module untouched. */
function planted(relativePath, mutate) {
  const target = resolve(SOURCE_ROOT, relativePath);
  return (absolute) => {
    const source = readFileSync(absolute, "utf8");
    if (absolute !== target) return source;
    const next = mutate(source);
    assert.notEqual(next, source, `the mutation did not change ${relativePath}`);
    return next;
  };
}

function keysOf(result) {
  return result.reconciliation.undeclared.map((finding) => finding.key);
}

test("the tree is clean: every finding is declared and nothing is stale", () => {
  const result = checkPlaneWork();
  assert.deepEqual(result.problems, []);
  assert.deepEqual(keysOf(result), []);
  assert.deepEqual(result.reconciliation.stale, []);
  assert.equal(result.exitCode, 0);
});

test("rule 1 fails when a route stops folding its window through serveProjection", () => {
  // Both window routes are wrapped as `await serveProjection(`, so renaming the
  // call is a route that folds inline while still looking like the old code.
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replaceAll("await serveProjection(", "await foldRightHere("),
    ),
  });
  assert.deepEqual(keysOf(result).sort(), [
    "inline-fold::local-plane.ts::buildLocalDeveloperModel",
    "inline-fold::local-plane.ts::buildLocalOverview",
  ]);
  assert.equal(result.exitCode, 1);
});

test("rule 2 fails when a budgeted read stops declaring a budget", () => {
  // `/live` is the one route budgeted on BOTH bindings. Dropping the property
  // does not read as unbounded at the call site, which is the whole point: the
  // builder's default is null and the omission is invisible without this gate.
  //
  // The shape is `unprovable` rather than `absent` because what is left is
  // `{ ...directoryOption }`, and a spread can carry a budget this gate cannot
  // see into. Saying so is the honest answer; what it must never do is read the
  // absence of a literal property as proof of a bound.
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replace("            rowBudget: SESSION_MATERIALIZATION_MAX_ROWS,\n", ""),
    ),
  });
  assert.deepEqual(keysOf(result), [
    "unbounded-read::local-plane.ts::buildLocalLive::unprovable",
  ]);
  assert.match(
    result.reconciliation.undeclared[0].detail,
    /cannot prove is a number/,
  );
  assert.equal(result.exitCode, 1);
});

test("rule 2 refuses `rowBudget: undefined`, which is the default spelled out", () => {
  // The one-token bypass. `undefined` is byte-for-byte what the builder falls
  // back to, so a gate that reads it as a budget can be cleared by a diff that
  // changes nothing at runtime, and the diff looks like compliance.
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replace(
        "rowBudget: SESSION_MATERIALIZATION_MAX_ROWS,",
        "rowBudget: undefined,",
      ),
    ),
  });
  assert.deepEqual(keysOf(result), [
    "unbounded-read::local-plane.ts::buildLocalLive::absent",
  ]);
  assert.equal(result.exitCode, 1);
});

test("rule 2 refuses a budget it cannot prove is a number", () => {
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replace(
        "rowBudget: SESSION_MATERIALIZATION_MAX_ROWS,",
        "rowBudget: budgetFor(binding),",
      ),
    ),
  });
  assert.deepEqual(keysOf(result), [
    "unbounded-read::local-plane.ts::buildLocalLive::unprovable",
  ]);
  assert.equal(result.exitCode, 1);
});

test("a regression away from the accepted shape does not match its acceptance", () => {
  // The shape is in the key for this reason. Keyed on module::builder alone, a
  // site that dropped its conditional budget entirely matched the entry that
  // excused the conditional, and the gate excused a strictly worse shape than
  // anyone agreed to. The accepted shape here is `nullable`; what is left after
  // the property is deleted is `unprovable`, and the point is that it is a
  // DIFFERENT key rather than which word it is.
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replace(
        "        rowBudget: binding.mode === \"loopback\" ? null : SESSION_OUTCOME_MAX_ROWS,\n",
        "",
      ),
    ),
  });
  assert.deepEqual(keysOf(result), [
    "unbounded-read::local-plane.ts::buildLocalSessionOutcome::unprovable",
  ]);
  assert.equal(result.exitCode, 1);
});

test("rule 1 is not satisfied by sitting inside serveProjection's argument list", () => {
  // Arguments one to four are evaluated on the request thread before
  // serveProjection is entered. Only the function literals defer anything.
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source.replace(
        '          { rangeDays, archivedRepoIds: [...archivedRepoIds].sort() },',
        '          buildLocalOverview({ ...directoryOption, nowMs: 0, rangeDays, archivedRepoIds }),',
      ),
    ),
  });
  assert.ok(
    keysOf(result).includes("inline-fold::local-plane.ts::buildLocalOverview"),
    `a fold in argument position must be reported, got ${JSON.stringify(keysOf(result))}`,
  );
  assert.equal(result.exitCode, 1);
});

test("rule 1 follows a namespace import into the builder module", () => {
  const result = checkPlaneWork({
    read: planted("local-plane.ts", (source) =>
      source
        .replace(
          'import {\n  buildLocalDeveloperModel,',
          'import * as projection from "./local-projection.ts";\nimport {\n  buildLocalDeveloperModel,',
        )
        .replace(
          "    case \"/settings\":",
          "    case \"/smuggled\":\n      sendJson(binding, res, 200, projection.buildLocalOverview({ nowMs: 0, rangeDays: 90 }));\n      return;\n\n    case \"/settings\":",
        ),
    ),
  });
  assert.ok(
    keysOf(result).includes("inline-fold::local-plane.ts::buildLocalOverview"),
    `a namespace-imported fold must be reported, got ${JSON.stringify(keysOf(result))}`,
  );
  assert.equal(result.exitCode, 1);
});

test("rule 3 fails a guard that is taken and never released", () => {
  // A run-once latch: the tick fires, takes the flag, and every later tick
  // returns immediately for the life of the process. Strictly worse than the
  // overlap the guard was added to prevent, and invisible in a two-line diff.
  const result = checkPlaneWork({
    read: planted("daemon.ts", (source) =>
      source.replace(
        "          .finally(() => {\n            syncingCaptureSettings = false;\n          });",
        ";",
      ),
    ),
  });
  assert.deepEqual(keysOf(result), ["latched-tick::SETTINGS_SYNC_MS"]);
  assert.equal(result.exitCode, 1);
});

test("rule 3 fails when recurring work escapes managedInterval entirely", () => {
  const result = checkPlaneWork({
    read: planted("daemon.ts", (source) =>
      source.replace(
        "    managedInterval(() => void flush(), COMPACT_SYNC_MS);",
        "    setInterval(() => void flush(), COMPACT_SYNC_MS);",
      ),
    ),
  });
  assert.ok(
    result.problems.some((problem) => problem.includes("setInterval")),
    `a bare setInterval must be a problem, got ${JSON.stringify(result.problems)}`,
  );
  assert.equal(result.exitCode, 1);
});

test("the reach floor fails when the walk stops applying the rules to a module", () => {
  // The floor counts builder call SITES, not files opened. Keyed on files, it
  // could not detect the blindness it exists for: the entry modules were marked
  // reached before a single call was inspected.
  const result = checkPlaneWork({
    read: planted("local-private-queries.ts", (source) =>
      source.replaceAll("buildLocalOverviewProjectionOn", "someOtherFold"),
    ),
  });
  assert.ok(
    result.problems.some((problem) => problem.includes("local-private-queries.ts")),
    `a module that stopped being covered must be a problem, got ${JSON.stringify(result.problems)}`,
  );
  assert.equal(result.exitCode, 1);
});

test("rule 3 fails when a tick loses its re-entrancy guard", () => {
  const result = checkPlaneWork({
    read: planted("daemon.ts", (source) =>
      source.replace("        if (syncingCaptureSettings) return;\n", ""),
    ),
  });
  assert.deepEqual(keysOf(result), ["unguarded-tick::SETTINGS_SYNC_MS"]);
  assert.equal(result.exitCode, 1);
});

test("a tick nobody has classified fails, even when it is guarded", () => {
  const result = checkPlaneWork({ acceptanceDocument: { ticks: [] } });
  const unclassified = keysOf(result).filter((key) => key.startsWith("unclassified-tick::"));
  assert.equal(unclassified.length, 5, "all five ticks should want a classification");
  assert.equal(result.exitCode, 1);
});

test("a classification for a tick the daemon no longer schedules is stale", () => {
  const result = checkPlaneWork({
    acceptanceDocument: {
      ticks: [{ key: "A_TICK_THAT_WAS_DELETED_MS", timeBudget: "not-needed", why: "gone" }],
    },
  });
  assert.ok(
    result.problems.some((problem) => problem.includes("A_TICK_THAT_WAS_DELETED_MS")),
    "a stale tick classification must be a problem, not a silently ignored row",
  );
  assert.equal(result.exitCode, 1);
});

test("derives the window and budget classification from the builder module itself", () => {
  const builders = builderSet(
    readFileSync(resolve(SOURCE_ROOT, "local-projection.ts"), "utf8"),
  );
  // `rangeDays` reaches these only through the named `LocalOverviewOptions` and
  // `LocalDeveloperModelOptions`, so a classifier that does not follow a type
  // reference reports every one of them as unwindowed.
  assert.equal(builders.get("buildLocalOverviewProjectionOn").windowed, true);
  assert.equal(builders.get("buildLocalDeveloperModel").windowed, true);
  // `rowBudget` is written inline as an intersection on these.
  assert.equal(builders.get("buildLocalReplay").budgeted, true);
  assert.equal(builders.get("buildLocalLive").budgeted, true);
  // And a builder that is neither is not this gate's business.
  assert.equal(builders.get("buildLocalSessionSummary").windowed, false);
  assert.equal(builders.get("buildLocalSessionSummary").budgeted, false);
});

test("sees the guard through the nested async shape three ticks are written in", () => {
  const { ticks, problems } = daemonTicks(
    readFileSync(resolve(SOURCE_ROOT, "daemon.ts"), "utf8"),
  );
  assert.deepEqual(problems, []);
  const guarded = Object.fromEntries(ticks.map((tick) => [tick.key, tick.guard]));
  // These three are `() => void (async () => { ... })()`.
  assert.equal(guarded.MOMENTUM_SWEEP_MS, "guarded");
  assert.equal(guarded.INTERVENTION_SWEEP_MS, "guarded");
  assert.equal(guarded.CODEX_POLL_MS, "guarded");
  // This one is a plain arrow body whose release sits in a promise `.finally`.
  assert.equal(guarded.SETTINGS_SYNC_MS, "guarded");
});

test("staleTickDeclarations names only the classifications with no live tick", () => {
  const ticks = [{ key: "LIVE_MS", line: 1, guard: "guarded", guarded: true }];
  const declared = [
    { key: "LIVE_MS", timeBudget: "not-needed", why: "here" },
    { key: "DEAD_MS", timeBudget: "not-needed", why: "gone" },
  ];
  assert.deepEqual(
    staleTickDeclarations(ticks, declared).map((tick) => tick.key),
    ["DEAD_MS"],
  );
});
