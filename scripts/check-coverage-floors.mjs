#!/usr/bin/env node

/**
 * Focused coverage floors for the five seams where a silent loss of test
 * coverage is a product failure rather than a style problem: route
 * authorization, event ingest, push delivery, shared client reads, and the
 * JavaScript half of the native Live Activity boundary.
 *
 * There is deliberately no repository-wide percentage. A global number can be
 * held up by whichever package happens to have the most tests, which is the
 * opposite of a gate. Every floor here names one file.
 *
 * Each floor sits at or slightly below a measured value. Floors of exactly 100
 * are used only where the measurement was proven identical across repeated runs
 * on both Node 22 (CI) and Node 24 (developer machines); those files may not
 * lose a single line, branch or function without failing.
 *
 * Two runners are in play and they are not interchangeable:
 *
 *   vitest  - the worker suite. `coverage.include` reports a listed file even
 *             when no test loads it, so a file that drops out of the suite
 *             shows up as 0% instead of vanishing.
 *
 *   node    - `node:test` packages (types, push, mobile). Node's coverage merge
 *             across concurrently spawned test processes is not deterministic:
 *             running the whole push suite reports src/authAbuse.ts anywhere
 *             between 81.11% and 94.44% lines from one run to the next, with no
 *             source change. Each node seam is therefore measured from the
 *             specific test file that owns it, which was stable across every
 *             repeated run. This makes the floor a statement about that test
 *             file, not about incidental coverage from elsewhere in the suite.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_TEST_FLAGS = Object.freeze([
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--experimental-test-coverage",
  "--test-reporter=spec",
]);

/**
 * One entry per coverage process. Related Vitest seams share a focused run so
 * CI pays for one transform/import pass rather than one process per file.
 */
export const COVERAGE_RUNS = Object.freeze([
  {
    id: "worker",
    runner: "vitest",
    workspace: "packages/worker",
    // Coverage is a focused second pass after the complete worker suite. Keep
    // it on the tests that own these seams: running every worker test again
    // buffered hundreds of thousands of log lines and was terminated by the
    // hosted runner before Vitest could write its summary.
    tests: [
      "test/auth.test.ts",
      "test/browser-sessions.test.ts",
      "test/capability-gate-rows.test.ts",
      "test/cron-budget.test.ts",
      "test/delivery-ledger.test.ts",
      "test/event-ingest-boundary.test.ts",
      "test/event-ingest-compatibility.test.ts",
      "test/ingest-clock-skew.test.ts",
      "test/integration-credentials.test.ts",
      "test/intervention-delivery.test.ts",
      "test/live-activity.test.ts",
      "test/observability-events.test.ts",
      "test/owner-cell.test.ts",
      "test/private-integration-api.test.ts",
      "test/push-delivery.test.ts",
      "test/rate-limit.test.ts",
      "test/route-contract.test.ts",
      "test/session-ownership.test.ts",
      "test/session-projection.test.ts",
      "test/workspace-principals.test.ts",
    ],
    floors: Object.freeze({
      // AUTH: the complete method/path authorization policy and the one
      // middleware that enforces it, plus the abuse budget and capability
      // gates it delegates to.
      "src/routeAccess.ts": { seam: "auth", lines: 100, branches: 100, functions: 100 },
      "src/authAbuse.ts": { seam: "auth", lines: 100, branches: 100, functions: 100 },
      "src/capabilityGates.ts": { seam: "auth", lines: 100, branches: 100, functions: 100 },
      "src/rateLimit.ts": { seam: "auth", lines: 100, branches: 89, functions: 100 },
      // INGEST: the worker's event and session ingest boundaries.
      "src/eventIngest.ts": { seam: "ingest", lines: 93, branches: 90, functions: 78 },
      "src/sessionIngest.ts": { seam: "ingest", lines: 100, branches: 100, functions: 100 },
      // PUSH: the worker's delivery and dispatch path.
      "src/pushDelivery.ts": { seam: "push", lines: 100, branches: 48, functions: 100 },
      "src/interventionDelivery.ts": { seam: "push", lines: 94, branches: 74, functions: 100 },
      "src/deliveryLedger.ts": { seam: "push", lines: 83, branches: 76, functions: 95 },
    }),
  },
  {
    id: "types-event-validation",
    runner: "node",
    workspace: "packages/types",
    tests: ["test/event-validation.test.ts"],
    file: "src/event-validation.ts",
    floor: { seam: "ingest", lines: 100, branches: 100, functions: 100 },
  },
  {
    id: "push-dispatch",
    runner: "node",
    workspace: "packages/push",
    tests: ["test/delivery-contract.test.ts"],
    file: "src/routes.ts",
    floor: { seam: "push", lines: 85, branches: 79, functions: 87 },
  },
  {
    id: "push-auth",
    runner: "node",
    workspace: "packages/push",
    tests: ["test/auth.test.ts"],
    file: "src/authAbuse.ts",
    floor: { seam: "push", lines: 92, branches: 91, functions: 100 },
  },
  {
    id: "push-config",
    runner: "node",
    workspace: "packages/push",
    tests: ["test/config.test.ts"],
    file: "src/config.ts",
    floor: { seam: "push", lines: 97, branches: 94, functions: 100 },
  },
  {
    id: "mobile-polling-lifecycle",
    runner: "node",
    workspace: "apps/mobile",
    tests: ["test/pollingLifecycle.test.mts"],
    file: "src/lib/pollingLifecycle.ts",
    floor: { seam: "read", lines: 100, branches: 100, functions: 100 },
  },
  {
    id: "mobile-worker-read-lifecycle",
    runner: "node",
    workspace: "apps/mobile",
    tests: ["test/workerReadLifecycle.test.mts"],
    file: "src/lib/workerReadLifecycle.ts",
    floor: { seam: "read", lines: 100, branches: 100, functions: 100 },
  },
  {
    id: "web-read-contract",
    runner: "vitest",
    workspace: "packages/web",
    tests: [
      "src/lib/stores/__tests__/overviewPolling.test.ts",
      "src/lib/stores/__tests__/livePolling.test.ts",
      "src/hooks/overviewViewState.test.ts",
      "src/lib/schemas/__tests__/overview-contract.test.ts",
      "src/lib/schemas/__tests__/live-contract.test.ts",
      "src/lib/schemas/__tests__/validate-resilience.test.ts",
      "src/lib/schemas/__tests__/contract-parity.test.ts",
      "src/lib/schemas/__tests__/codex-capture-parity.test.ts",
      "src/lib/schemas/__tests__/end-reason-parity.test.ts",
      "src/lib/schemas/__tests__/delivery-health-contract.test.ts",
    ],
    floors: Object.freeze({
      "src/lib/stores/polling.ts": {
        seam: "read",
        lines: 65,
        branches: 53,
        functions: 63,
      },
      "src/hooks/overviewViewState.ts": {
        seam: "read",
        lines: 100,
        branches: 100,
        functions: 100,
      },
      "src/lib/apiSchemas.ts": {
        seam: "read",
        lines: 100,
        branches: 100,
        functions: 100,
      },
      "src/lib/schemas/common.ts": {
        seam: "read",
        lines: 85,
        branches: 75,
        functions: 68,
      },
    }),
  },
  // NATIVE: the Swift half of this seam carries no JavaScript coverage number
  // at all and is gated by compilation and patch contracts instead. What a
  // percentage can protect is the JavaScript state machine that decides which
  // token reaches the native module, and in which environment.
  {
    id: "mobile-delivery-token-replay",
    runner: "node",
    workspace: "apps/mobile",
    tests: ["test/deliveryTokenReplay.test.mts"],
    file: "src/liveActivity/deliveryTokenReplay.ts",
    floor: { seam: "native", lines: 88, branches: 73, functions: 100 },
  },
  {
    id: "mobile-device-authority",
    runner: "node",
    workspace: "apps/mobile",
    tests: ["test/deviceAuthorityState.test.mts"],
    file: "src/liveActivity/deviceAuthorityState.ts",
    floor: { seam: "native", lines: 89, branches: 69, functions: 100 },
  },
  {
    id: "mobile-startup-environment-sync",
    runner: "node",
    workspace: "apps/mobile",
    tests: ["test/startupEnvironmentSync.test.mts"],
    file: "src/liveActivity/startupEnvironmentSync.ts",
    floor: { seam: "native", lines: 90, branches: 76, functions: 68 },
  },
]);

const METRICS = Object.freeze(["lines", "branches", "functions"]);

export function shortfalls(label, measured, floor) {
  return METRICS.flatMap((metric) => {
    const value = measured[metric];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return [`${label}: no ${metric} coverage was reported`];
    }
    if (value + 1e-9 < floor[metric]) {
      return [
        `${label}: ${metric} coverage ${value.toFixed(2)}% is below the ${floor[metric]}% floor`,
      ];
    }
    return [];
  });
}

/**
 * Reads the one file row out of `node --experimental-test-coverage`'s report.
 * A run scoped to a single include glob has exactly one row; anything else —
 * including the empty report node prints (as 100%) when the glob matches
 * nothing — is treated as a failure rather than a pass.
 */
export function parseNodeCoverageRow(stdout, file) {
  const name = basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${name}\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*([\\d.]+)\\s*\\|`,
  );
  const match = pattern.exec(stdout);
  if (!match) return null;
  return {
    lines: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3]),
  };
}

export function nodeCoverageArgs(run) {
  return [
    ...NODE_TEST_FLAGS,
    `--test-coverage-include=${run.file}`,
    `--test-coverage-lines=${run.floor.lines}`,
    `--test-coverage-branches=${run.floor.branches}`,
    `--test-coverage-functions=${run.floor.functions}`,
    "--test",
    ...run.tests,
  ];
}

export function vitestCoverageArgs(run, reportsDirectory) {
  return [
    "run",
    ...(run.tests ?? []),
    "--coverage",
    "--coverage.provider=v8",
    "--coverage.reporter=json-summary",
    "--silent=passed-only",
    `--coverage.reportsDirectory=${reportsDirectory}`,
    ...Object.keys(run.floors).map((file) => `--coverage.include=${file}`),
  ];
}

function vitestBin(workspaceDirectory) {
  const resolveFromWorkspace = createRequire(join(workspaceDirectory, "package.json"));
  const manifestPath = resolveFromWorkspace.resolve("vitest/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vitest;
  return resolve(dirname(manifestPath), entry);
}

function runNodeSeam(run, workspaceDirectory, log) {
  const result = spawnSync(process.execPath, nodeCoverageArgs(run), {
    cwd: workspaceDirectory,
    encoding: "utf8",
  });
  const stdout = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const measured = parseNodeCoverageRow(stdout, run.file);
  if (!measured) {
    return {
      problems: [
        `${run.workspace}/${run.file}: no coverage record was produced by ${run.tests.join(", ")}` +
          ` — the file was renamed, or the test stopped loading it`,
      ],
      detail: stdout,
    };
  }
  const label = `${run.workspace}/${run.file}`;
  const problems = shortfalls(label, measured, run.floor);
  // Node enforces the same floors itself; a non-zero exit with no shortfall of
  // our own means the test run failed, which is also a gate failure.
  if (problems.length === 0 && result.status !== 0) {
    problems.push(`${label}: coverage run exited ${result.status}`);
  }
  log(run.floor.seam, label, measured, run.floor);
  return { problems, detail: problems.length > 0 ? stdout : "" };
}

function runVitestSeam(run, workspaceDirectory, log) {
  const reportsDirectory = mkdtempSync(join(tmpdir(), "seorak-coverage-"));
  try {
    const result = spawnSync(
      process.execPath,
      [vitestBin(workspaceDirectory), ...vitestCoverageArgs(run, reportsDirectory)],
      { cwd: workspaceDirectory, encoding: "utf8" },
    );
    const summaryPath = join(reportsDirectory, "coverage-summary.json");
    if (!existsSync(summaryPath)) {
      // vitest writes no summary when the suite itself is red, so report the
      // failing suite rather than blaming the coverage configuration.
      return {
        problems: [
          result.status === 0
            ? `${run.workspace}: vitest produced no coverage summary`
            : `${run.workspace}: the test suite failed (exit ${result.status}), so no coverage was measured`,
        ],
        detail: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      };
    }
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const byFile = new Map(
      Object.entries(summary)
        .filter(([key]) => key !== "total")
        .map(([key, value]) => [key, value]),
    );
    const problems = [];
    for (const [file, floor] of Object.entries(run.floors)) {
      const absolute = resolve(workspaceDirectory, file);
      const entry = byFile.get(absolute);
      const label = `${run.workspace}/${file}`;
      if (!entry) {
        problems.push(`${label}: no coverage record was produced`);
        continue;
      }
      const measured = {
        lines: entry.lines.pct,
        branches: entry.branches.pct,
        functions: entry.functions.pct,
      };
      problems.push(...shortfalls(label, measured, floor));
      log(floor.seam, label, measured, floor);
    }
    if (problems.length === 0 && result.status !== 0) {
      problems.push(`${run.workspace}: coverage run exited ${result.status}`);
    }
    return { problems, detail: problems.length > 0 ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "" };
  } finally {
    rmSync(reportsDirectory, { recursive: true, force: true });
  }
}

export function checkCoverageFloors(repositoryRoot = REPO_ROOT, runs = COVERAGE_RUNS) {
  const problems = [];
  const details = [];
  const rows = [];
  const log = (seam, label, measured, floor) => {
    rows.push(
      `${seam.padEnd(7)} ${label.padEnd(55)} ` +
        METRICS.map(
          (metric) =>
            `${metric[0].toUpperCase()} ${String(measured[metric].toFixed(2)).padStart(6)}/${String(floor[metric]).padStart(3)}`,
        ).join("  "),
    );
  };

  for (const run of runs) {
    const workspaceDirectory = resolve(repositoryRoot, run.workspace);
    const outcome =
      run.runner === "vitest"
        ? runVitestSeam(run, workspaceDirectory, log)
        : runNodeSeam(run, workspaceDirectory, log);
    problems.push(...outcome.problems);
    if (outcome.detail) details.push(outcome.detail);
  }

  return { problems, details, rows };
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const { problems, details, rows } = checkCoverageFloors();
  console.log(`seam    ${"file".padEnd(55)} measured/floor`);
  for (const row of rows) console.log(row);
  if (problems.length > 0) {
    for (const detail of details) console.error(detail);
    console.error(
      `Critical seam coverage floors failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Critical seam coverage floors passed (${rows.length} files).`);
  }
}
