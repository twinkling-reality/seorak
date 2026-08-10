#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
    // 2 is the schema whose `graphSha256` covers the advisory claim rather than
    // the whole report. A version 1 baseline hashed npm's remediation
    // attribution with it and cannot be compared against this one, so it is
    // refused by name instead of failing as a mismatch nobody can re-triage.
    schemaVersion: 2,
    auditReportVersion: 2,
    measuredAt,
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

export function assertAdvisoryBaseline(report, expected) {
  if (expected?.schemaVersion !== 2) {
    throw new DependencyAdvisoryPolicyError(
      "dependency advisory baseline has an unsupported schema",
    );
  }
  const actual = advisoryBaseline(report, expected.measuredAt);
  if (
    JSON.stringify(comparableBaseline(actual)) !==
    JSON.stringify(comparableBaseline(expected))
  ) {
    throw new DependencyAdvisoryPolicyError(
      "npm advisory graph differs from the reviewed baseline; re-triage " +
        "dependency reachability before updating the baseline and posture document",
    );
  }
  return {
    ...actual,
    informationalDrift: informationalDrift(actual.entries, expected.entries),
  };
}

function runNpmAudit() {
  const result = spawnSync("npm", NPM_AUDIT_ARGS, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new DependencyAdvisoryPolicyError(
      "npm audit could not produce a dependency report",
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
    const report = runNpmAudit();
    if (
      process.argv.includes("--print-baseline") ||
      process.argv.includes("--write-baseline")
    ) {
      const rendered = `${JSON.stringify(advisoryBaseline(report), null, 2)}\n`;
      if (process.argv.includes("--write-baseline")) {
        writeFileSync(BASELINE_PATH, rendered, "utf8");
        console.log(`Wrote reviewed advisory baseline to ${BASELINE_PATH}`);
      } else {
        process.stdout.write(rendered);
      }
    } else {
      const expected = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
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
