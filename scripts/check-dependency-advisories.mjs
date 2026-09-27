#!/usr/bin/env node

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(
  REPO_ROOT,
  "docs/reference/dependency-advisory-baseline.json",
);
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const DEPENDENCY_CLASSES = [
  "prod",
  "dev",
  "optional",
  "peer",
  "peerOptional",
  "total",
];
export const NPM_AUDIT_ARGS = Object.freeze([
  "audit",
  "--json",
  "--include=prod",
  "--include=dev",
  "--include=optional",
  "--include=peer",
]);
const compareStrings = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * The fields npm answers non-deterministically on this graph, held in the
 * baseline and reported on every run, but outside the checked identity.
 *
 * MEASURED, 2026-08-07, six consecutive `npm audit` runs on an unchanged tree:
 * a hash over the whole normalized report took three different values, and a
 * hash over the entry minus these two was identical all six times. npm credits
 * either `expo` or `react-native` with owning one remediation cascade joined by
 * `@mobile-surfaces/live-activity` peer ranges on both; five entries' fix
 * attribution and three entries' `effects` move together between two
 * self-consistent answers. `--prefer-offline` was tested as a control and still
 * flapped.
 *
 * They are kept rather than dropped because
 * `docs/reference/dependency-advisory-posture.md` carries a standing rule that a
 * fixed release which fits the deployed runtime beats an acceptance, and that
 * rule needs to know a fix exists. It is the rule that retired the miniflare and
 * `@hono/node-server` acceptances. Dropping the field entirely would trade a
 * flaky gate for a blind one.
 *
 * Everything NOT named here is identity. A field npm adds tomorrow lands inside
 * the hash without anyone remembering to put it there, which fails toward more
 * coverage; loosening is the edit that has to be deliberate.
 */
export const INFORMATIONAL_FIELDS = Object.freeze(["effects", "fixAvailable"]);

/**
 * THE AUDIT RUNS UNDER THE npm THE BASELINE RECORDS, NOT WHATEVER IS ON PATH.
 *
 * `range` is not a GHSA field. For a carried edge it is computed locally, by
 * `Advisory[_calculateRange]` in `@npmcli/metavuln-calculator`, which walks
 * contiguous runs of versions its `[_testSpec]` marked vulnerable. That
 * predicate changed in metavuln-calculator 9.0.1, first shipped in npm 11.5.0:
 *
 *   before   const satisfies = semver.satisfies(v, spec)
 *   after    const satisfies = semver.satisfies(v, spec, semverOpt)
 *
 * `semverOpt` carries `includePrerelease`, so the newer npm can find a
 * prerelease escape the older one cannot, and one contiguous vulnerable run
 * splits in two. Measured on this repository on 2026-09-09, the same lockfile
 * and the same installed tree:
 *
 *   npm 10.9.8  @react-navigation/native-stack  range "<=7.18.10"
 *               graphSha256 0bea469db650e543...
 *   npm 11.12.1 @react-navigation/native-stack  range "<=5.0.4 || 6.0.0-next.1 - 7.18.10"
 *               graphSha256 1f883139fcfbbc96...
 *
 * Proven to be that one line: patching it into npm 10.9.8 and changing nothing
 * else reproduces npm 11's hash exactly. node is NOT the variable; node 22.23.2
 * running npm 11.12.1 reproduces the npm 11 hash.
 *
 * That made the gate green in one place and red in the other with no dependency
 * change anywhere: CI pins `node-version: "22"`, whose bundled npm was 10.9.8,
 * while this repository's author runs 11.12.1. A claim whose value depends on
 * which npm asked is not a claim two machines can agree on.
 *
 * THE FIX IS TO PIN THE DERIVATION, NOT TO STOP ASSERTING THE FIELD. Excluding
 * `range` was considered and rejected: ten of the twenty-six entries carry a
 * range derived from GHSA `vulnerable_versions` and six of those differ from
 * npm's rollup, so dropping it would take real advisory news out of the
 * comparison to fix an environment split. Asserting the ambient npm and failing
 * on a mismatch was also rejected: `advisories:check` is chained into the root
 * `test` script, so that hard stop would fire on the everyday command every time
 * Homebrew moved npm, and this repository's own gates argue that a gate which
 * fails correct code gets weakened rather than obeyed.
 *
 * WHAT IT COSTS, said plainly. When the ambient npm is not the recorded one the
 * gate fetches that npm from the registry through `npx`, by exact version but
 * with no integrity hash of its own. That is the same registry this project
 * already trusts for every dependency, minus the lockfile pin, inside the gate
 * whose subject is dependency risk. It is a real cost and it is why the ambient
 * npm is used directly whenever it already matches: on the author's machine
 * nothing is fetched, and only a runner whose bundled npm differs pays it.
 */
const NPX_PIN_ARGS = Object.freeze(["-y", "npm@"]);

export class DependencyAdvisoryPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "DependencyAdvisoryPolicyError";
  }
}

function policyError(message) {
  throw new DependencyAdvisoryPolicyError(`invalid npm audit report: ${message}`);
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    policyError(`${label} must be an object`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    policyError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") policyError(`${label} must be a boolean`);
  return value;
}

function requiredStringArray(value, label) {
  if (!Array.isArray(value)) policyError(`${label} must be an array`);
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

function requiredCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    policyError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function normalizedSeverity(value, label) {
  const severity = requiredString(value, label);
  if (!SEVERITIES.includes(severity)) policyError(`${label} is unknown`);
  return severity;
}

function normalizedFix(fixAvailable, label) {
  if (typeof fixAvailable === "boolean") return fixAvailable;
  const fix = requiredObject(fixAvailable, label);
  return {
    name: requiredString(fix.name, `${label}.name`),
    version: requiredString(fix.version, `${label}.version`),
    isSemVerMajor: requiredBoolean(
      fix.isSemVerMajor,
      `${label}.isSemVerMajor`,
    ),
  };
}

function normalizedVia(entry, label) {
  if (typeof entry === "string") {
    return {
      kind: "package",
      name: requiredString(entry, label),
    };
  }

  const advisory = requiredObject(entry, label);
  const url = requiredString(advisory.url, `${label}.url`);
  const match = /\/advisories\/(GHSA-[0-9a-z-]+)$/i.exec(url);
  if (!match) policyError(`${label}.url does not carry a GHSA identity`);
  const cvss = requiredObject(advisory.cvss, `${label}.cvss`);
  if (
    typeof cvss.score !== "number" ||
    !Number.isFinite(cvss.score) ||
    cvss.score < 0
  ) {
    policyError(`${label}.cvss.score must be a non-negative number`);
  }
  if (cvss.vectorString !== null && typeof cvss.vectorString !== "string") {
    policyError(`${label}.cvss.vectorString must be a string or null`);
  }

  return {
    kind: "advisory",
    ghsa: match[1].toUpperCase(),
    name: requiredString(advisory.name, `${label}.name`),
    dependency: requiredString(advisory.dependency, `${label}.dependency`),
    severity: normalizedSeverity(advisory.severity, `${label}.severity`),
    range: requiredString(advisory.range, `${label}.range`),
    cwe: requiredStringArray(advisory.cwe, `${label}.cwe`).sort(compareStrings),
    cvss: {
      score: cvss.score,
      vectorString: cvss.vectorString,
    },
  };
}

/**
 * Keep every risk-bearing audit attribute while dropping npm's installation
 * prose and npm source ids, which can change without advisory identity changing.
 * Advisory severity, range, CWE, CVSS, package edges, and installed paths remain
 * executable policy; npm's remediation attribution is carried under
 * `informational` and is not part of the identity. See `INFORMATIONAL_FIELDS`.
 *
 * The split is expressed in the entry's own shape rather than in a list a reader
 * has to find: everything outside `informational` is what the gate asserts.
 */
export function normalizeAuditReport(report) {
  if (
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new DependencyAdvisoryPolicyError(
      "npm audit returned an unsupported or incomplete report",
    );
  }

  const normalized = Object.entries(report.vulnerabilities)
    .map(([name, value]) => {
      const label = `vulnerabilities.${name}`;
      const vulnerability = requiredObject(value, label);
      if (requiredString(vulnerability.name, `${label}.name`) !== name) {
        policyError(`${label}.name does not match its map key`);
      }
      if (!Array.isArray(vulnerability.via)) {
        policyError(`${label}.via must be an array`);
      }
      const via = vulnerability.via
        .map((entry, index) => normalizedVia(entry, `${label}.via[${index}]`))
        .sort((left, right) =>
          compareStrings(JSON.stringify(left), JSON.stringify(right)),
        );

      return {
        name,
        severity: normalizedSeverity(vulnerability.severity, `${label}.severity`),
        direct: requiredBoolean(vulnerability.isDirect, `${label}.isDirect`),
        range: requiredString(vulnerability.range, `${label}.range`),
        via,
        nodes: requiredStringArray(vulnerability.nodes, `${label}.nodes`).sort(
          compareStrings,
        ),
        // Still validated as strictly as the identity is. A report npm could
        // not have produced is an unreadable report whichever field is wrong;
        // "informational" governs what the gate COMPARES, not what it trusts.
        informational: {
          effects: requiredStringArray(
            vulnerability.effects,
            `${label}.effects`,
          ).sort(compareStrings),
          fixAvailable: normalizedFix(
            vulnerability.fixAvailable,
            `${label}.fixAvailable`,
          ),
        },
      };
    })
    .sort((left, right) => compareStrings(left.name, right.name));

  const metadata = requiredObject(report.metadata, "metadata");
  const dependencyCounts = requiredObject(
    metadata.dependencies,
    "metadata.dependencies",
  );
  for (const dependencyClass of DEPENDENCY_CLASSES) {
    requiredCount(
      dependencyCounts[dependencyClass],
      `metadata.dependencies.${dependencyClass}`,
    );
  }
  const reportedCounts = requiredObject(
    metadata.vulnerabilities,
    "metadata.vulnerabilities",
  );
  const actualCounts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, 0]),
  );
  for (const entry of normalized) actualCounts[entry.severity] += 1;
  for (const severity of SEVERITIES) {
    const reported = requiredCount(
      reportedCounts[severity],
      `metadata.vulnerabilities.${severity}`,
    );
    if (reported !== actualCounts[severity]) {
      policyError(
        `metadata.vulnerabilities.${severity} does not match the package graph`,
      );
    }
  }
  const reportedTotal = requiredCount(
    reportedCounts.total,
    "metadata.vulnerabilities.total",
  );
  if (reportedTotal !== normalized.length) {
    policyError(
      "metadata.vulnerabilities.total does not match the package graph",
    );
  }

  return normalized;
}

/**
 * The advisory claim: which advisories exist against which packages, at what
 * severity, over which ranges and installed paths. This is what the gate
 * asserts, and it is every normalized field except `informational`.
 */
export function advisoryIdentity(entries) {
  return entries.map(({ informational, ...identity }) => identity);
}

/**
 * Where a run's remediation attribution differs from the baseline's. Reported on
 * every run and never fatal: the baseline records one of npm's two answers and
 * the gate may measure the other, so a difference here is news, not a finding.
 * A genuinely new fix shows up in the same list, which is the point of keeping
 * the field at all.
 */
export function informationalDrift(entries, expectedEntries) {
  const expectedByName = new Map(
    expectedEntries.map((entry) => [entry.name, entry]),
  );
  const drift = [];
  for (const entry of entries) {
    const expected = expectedByName.get(entry.name);
    if (expected === undefined) continue;
    for (const field of INFORMATIONAL_FIELDS) {
      const baseline = JSON.stringify(expected.informational?.[field]);
      const measured = JSON.stringify(entry.informational[field]);
      if (baseline !== measured) {
        drift.push({ name: entry.name, field, baseline, measured });
      }
    }
  }
  return drift;
}

export function advisoryBaseline(
  report,
  measuredAt = new Date().toISOString().slice(0, 10),
  derivedWith = null,
) {
  const normalized = normalizeAuditReport(report);
  const vulnerabilities = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, 0]),
  );
  for (const entry of normalized) {
    if (!(entry.severity in vulnerabilities)) {
      throw new DependencyAdvisoryPolicyError(
        `npm audit returned unknown severity ${entry.severity}`,
      );
    }
    vulnerabilities[entry.severity] += 1;
  }

  return {
    // 3 is the schema that records WHICH npm derived the claim. A version 2
    // baseline hashed the same fields but left the derivation environment
    // undeclared, and `range` on a carried edge is npm-version dependent, so a
    // version 2 baseline cannot be compared without knowing what produced it.
    // A version 1 baseline hashed npm's remediation attribution as well. Both
    // are refused by name rather than failing as a mismatch nobody can
    // re-triage.
    schemaVersion: 3,
    auditReportVersion: 2,
    measuredAt,
    // Metadata, deliberately OUTSIDE `comparableBaseline`: it says how the claim
    // was produced, not what the claim is. Comparing it would fail a baseline
    // that agrees about every advisory purely because the recorded npm moved.
    derivedWith: { npm: derivedWith },
    vulnerabilities: {
      ...vulnerabilities,
      total: normalized.length,
    },
    entries: normalized,
    graphSha256: createHash("sha256")
      .update(JSON.stringify(advisoryIdentity(normalized)))
      .digest("hex"),
  };
}

/** A baseline reduced to the part the gate compares. */
function comparableBaseline(baseline) {
  return {
    schemaVersion: baseline.schemaVersion,
    auditReportVersion: baseline.auditReportVersion,
    measuredAt: baseline.measuredAt,
    vulnerabilities: baseline.vulnerabilities,
    entries: advisoryIdentity(baseline.entries ?? []),
    graphSha256: baseline.graphSha256,
  };
}

/** Human-readable claim differences between measured and reviewed baselines. */
export function describeBaselineDiff(actual, expected) {
  const lines = [];
  const aVuln = actual.vulnerabilities ?? {};
  const eVuln = expected.vulnerabilities ?? {};
  for (const key of [...SEVERITIES, "total"]) {
    if (aVuln[key] !== eVuln[key]) {
      lines.push(`vulnerabilities.${key}: baseline ${eVuln[key]}, measured ${aVuln[key]}`);
    }
  }
  const actualByName = new Map((actual.entries ?? []).map((entry) => [entry.name, entry]));
  const expectedByName = new Map((expected.entries ?? []).map((entry) => [entry.name, entry]));
  for (const name of expectedByName.keys()) {
    if (!actualByName.has(name)) lines.push(`entry removed: ${name}`);
  }
  for (const name of actualByName.keys()) {
    if (!expectedByName.has(name)) lines.push(`entry added: ${name}`);
  }
  for (const [name, measured] of actualByName) {
    const baseline = expectedByName.get(name);
    if (baseline === undefined) continue;
    const measuredClaim = JSON.stringify(advisoryIdentity([measured])[0]);
    const baselineClaim = JSON.stringify(advisoryIdentity([baseline])[0]);
    if (measuredClaim !== baselineClaim) {
      lines.push(`entry changed: ${name}`);
      lines.push(`  baseline: ${baselineClaim}`);
      lines.push(`  measured: ${measuredClaim}`);
    }
  }
  if (actual.graphSha256 !== expected.graphSha256) {
    lines.push(
      `graphSha256: baseline ${expected.graphSha256}, measured ${actual.graphSha256}`,
    );
  }
  lines.push(
    "Inspect the live claim with: node scripts/check-dependency-advisories.mjs --print-baseline",
  );
  return lines;
}

export function assertAdvisoryBaseline(report, expected) {
  if (expected?.schemaVersion !== 3) {
    throw new DependencyAdvisoryPolicyError(
      "dependency advisory baseline has an unsupported schema",
    );
  }
  const actual = advisoryBaseline(
    report,
    expected.measuredAt,
    expected.derivedWith?.npm ?? null,
  );
  if (
    JSON.stringify(comparableBaseline(actual)) !==
    JSON.stringify(comparableBaseline(expected))
  ) {
    const detail = describeBaselineDiff(actual, expected).join("\n  ");
    throw new DependencyAdvisoryPolicyError(
      "npm advisory graph differs from the reviewed baseline; re-triage " +
        "dependency reachability before updating the baseline and posture document\n  " +
        detail,
    );
  }
  return {
    ...actual,
    informationalDrift: informationalDrift(actual.entries, expected.entries),
  };
}

/** The npm on PATH, or null when it cannot be asked. */
export function ambientNpmVersion(spawn = spawnSync) {
  const result = spawn("npm", ["--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) return null;
  const version = String(result.stdout ?? "").trim();
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * A cache directory owned by one npm version, never the ambient one.
 *
 * PINNING THE BINARY IS NOT ENOUGH, and the first version of this shipped
 * believing it was. `@npmcli/metavuln-calculator` writes each advisory it
 * COMPUTES into the npm cache, and a later npm reads that entry back rather
 * than recomputing it. So the claim is a function of two things, the npm and
 * the cache, and whichever npm populated the cache wins whatever runs later.
 *
 * Measured 2026-09-10 against the same lockfile, `@react-navigation/native-stack`:
 *
 *   npm 10.9.8, this machine's warm cache   <=5.0.4 || 6.0.0-next.1 - 7.18.10
 *   npm 10.9.8, cold cache                  <=7.18.10
 *   npm 11.12.1, cold cache                 <=5.0.4 || 6.0.0-next.1 - 7.18.10
 *
 * The first row is npm 10 returning npm 11's answer out of the cache. That is
 * exactly what happened in CI when only the binary was pinned: `actions/setup-node`
 * restores an npm cache that earlier runs populated under node 22's npm 10, and
 * the pinned npm 11 read those entries straight back.
 *
 * So the cache is keyed by the recorded version. Changing the pin therefore
 * changes the directory, which is what stops a stale computation outliving the
 * npm that made it. It lives under the OS temp directory rather than in the
 * repository: a developer keeps it between runs and pays the fetch once, and a
 * fresh CI runner starts cold, which is correct rather than merely acceptable.
 */
export function auditCacheDirectory(version, root = tmpdir()) {
  return join(root, `seorak-advisory-cache-npm-${version ?? "ambient"}`);
}

/**
 * How to invoke the audit so that it answers as `pinned` did.
 *
 * The npm BINARY is left alone when the ambient one already is the recorded
 * one, which keeps the registry fetch off the developer's every run. The CACHE
 * is version-keyed either way, because the ambient cache is shared with every
 * other npm that has ever run on the machine and is the second half of the
 * derivation.
 */
export function auditInvocation(pinned, ambient, root = tmpdir()) {
  const cache = ["--cache", auditCacheDirectory(pinned ?? ambient, root)];
  if (pinned === null || pinned === undefined || pinned === ambient) {
    return { command: "npm", args: [...NPM_AUDIT_ARGS, ...cache], pinned: false };
  }
  return {
    command: "npx",
    args: [
      NPX_PIN_ARGS[0],
      `${NPX_PIN_ARGS[1]}${pinned}`,
      ...NPM_AUDIT_ARGS,
      ...cache,
    ],
    pinned: true,
  };
}

function runNpmAudit(pinned = null) {
  const invocation = auditInvocation(pinned, ambientNpmVersion());
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new DependencyAdvisoryPolicyError(
      invocation.pinned
        ? `npm audit could not produce a dependency report under the recorded npm ${pinned}. ` +
          "The baseline names the npm it was derived with; a runner that cannot fetch it " +
          "cannot check this claim."
        : "npm audit could not produce a dependency report",
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new DependencyAdvisoryPolicyError(
      "npm audit returned an unreadable dependency report",
    );
  }
}

function isMain() {
  return process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMain()) {
  try {
    const writing =
      process.argv.includes("--print-baseline") ||
      process.argv.includes("--write-baseline");
    // Writing DERIVES a new claim, so it runs under the npm the operator is
    // actually holding and records that version. Checking COMPARES an existing
    // claim, so it runs under the npm that claim names. Reading the baseline
    // before the audit is what makes the second possible.
    const reviewed = writing
      ? null
      : JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const report = runNpmAudit(writing ? null : reviewed?.derivedWith?.npm ?? null);
    if (writing) {
      const rendered = `${JSON.stringify(advisoryBaseline(report, undefined, ambientNpmVersion()), null, 2)}\n`;
      if (process.argv.includes("--write-baseline")) {
        writeFileSync(BASELINE_PATH, rendered, "utf8");
        console.log(`Wrote reviewed advisory baseline to ${BASELINE_PATH}`);
      } else {
        process.stdout.write(rendered);
      }
    } else {
      const expected = reviewed;
      const actual = assertAdvisoryBaseline(report, expected);
      console.log(
        `Dependency advisory policy passed: ${actual.vulnerabilities.total} ` +
          `reviewed package finding(s), claim ${actual.graphSha256.slice(0, 12)}`,
      );
      // Printed, not swallowed. This is the only place a newly available fix
      // surfaces now that attribution is outside the identity, and the posture
      // document's remediate-over-accept rule reads it.
      if (actual.informationalDrift.length > 0) {
        console.log(
          `Informational, outside the asserted claim: ` +
            `${actual.informationalDrift.length} remediation field(s) differ ` +
            `from the baseline`,
        );
        for (const { name, field, baseline, measured } of actual.informationalDrift) {
          console.log(`  ${name}.${field}: baseline ${baseline}, measured ${measured}`);
        }
      }
    }
  } catch (error) {
    console.error(
      error instanceof DependencyAdvisoryPolicyError
        ? error.message
        : "Dependency advisory policy failed",
    );
    process.exitCode = 1;
  }
}
