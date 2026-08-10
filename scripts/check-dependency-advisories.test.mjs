import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  DependencyAdvisoryPolicyError,
  INFORMATIONAL_FIELDS,
  NPM_AUDIT_ARGS,
  advisoryBaseline,
  advisoryIdentity,
  assertAdvisoryBaseline,
  normalizeAuditReport,
} from "./check-dependency-advisories.mjs";
import { holdsPrivateHalf, loadOwnership } from "./open-core-ownership.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function report(overrides = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      packageA: {
        name: "packageA",
        severity: "high",
        isDirect: true,
        range: "<2",
        via: [
          {
            source: 123,
            title: "mutable prose",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            name: "packageA",
            dependency: "packageA",
            severity: "high",
            range: "<2",
            cwe: ["CWE-400"],
            cvss: {
              score: 7.5,
              vectorString: "CVSS:3.1/AV:N/AC:L",
            },
          },
        ],
        effects: ["wrapper"],
        nodes: ["node_modules/packageA"],
        fixAvailable: { name: "packageA", version: "2.0.0", isSemVerMajor: true },
      },
      wrapper: {
        name: "wrapper",
        severity: "high",
        isDirect: false,
        range: "*",
        via: ["packageA"],
        effects: [],
        nodes: ["node_modules/wrapper"],
        fixAvailable: false,
      },
    },
    metadata: {
      dependencies: {
        prod: 1,
        dev: 1,
        optional: 0,
        peer: 0,
        peerOptional: 0,
        total: 2,
      },
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    },
    ...overrides,
  };
}

test("normalization keeps risk identity and drops mutable prose", () => {
  const first = normalizeAuditReport(report());
  const changedProse = report();
  changedProse.vulnerabilities.packageA.via[0].source = 999;
  changedProse.vulnerabilities.packageA.via[0].title = "rewritten title";
  assert.deepEqual(normalizeAuditReport(changedProse), first);
  assert.equal(first[0].via[0].ghsa, "GHSA-AAAA-BBBB-CCCC");
});

test("the baseline changes for every package and advisory risk attribute", () => {
  const expected = advisoryBaseline(report(), "2026-07-30");
  for (const mutate of [
    (next) => next.vulnerabilities.packageA.via.push({
      url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
      name: "packageA",
      dependency: "packageA",
      severity: "high",
      range: "<2",
      cwe: ["CWE-400"],
      cvss: { score: 7.5, vectorString: null },
    }),
    (next) => {
      next.vulnerabilities.packageA.severity = "critical";
      next.metadata.vulnerabilities.high = 1;
      next.metadata.vulnerabilities.critical = 1;
    },
    (next) =>
      next.vulnerabilities.packageA.nodes.push(
        "node_modules/tool/node_modules/packageA",
      ),
    (next) => {
      next.vulnerabilities.packageA.range = "<3";
    },
    (next) => {
      next.vulnerabilities.packageA.isDirect = false;
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].severity = "critical";
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].range = "<3";
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].cwe = ["CWE-770"];
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].cvss.score = 9.1;
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].cvss.vectorString =
        "CVSS:3.1/AV:N/AC:L/PR:N";
    },
  ]) {
    const next = structuredClone(report());
    mutate(next);
    assert.throws(
      () => assertAdvisoryBaseline(next, expected),
      DependencyAdvisoryPolicyError,
    );
  }
});

test("npm's two remediation answers are one identity and a reported difference", () => {
  // The measured flake in miniature. On the real graph npm credits either
  // `expo` or `react-native` with owning one remediation cascade, and `effects`
  // moves with it; here it credits either `packageA` or `wrapper`. Same
  // advisory, same package, same severity, same range, same installed paths.
  const creditsA = report();
  const creditsWrapper = report();
  creditsWrapper.vulnerabilities.packageA.fixAvailable = false;
  creditsWrapper.vulnerabilities.packageA.effects = [];
  creditsWrapper.vulnerabilities.wrapper.fixAvailable = {
    name: "wrapper",
    version: "2.0.0",
    isSemVerMajor: true,
  };
  creditsWrapper.vulnerabilities.wrapper.effects = ["packageA"];

  const first = normalizeAuditReport(creditsA);
  const second = normalizeAuditReport(creditsWrapper);
  assert.notDeepEqual(second, first);
  assert.deepEqual(advisoryIdentity(second), advisoryIdentity(first));
  assert.equal(
    advisoryBaseline(creditsWrapper, "2026-08-07").graphSha256,
    advisoryBaseline(creditsA, "2026-08-07").graphSha256,
  );

  // The gate passes on whichever answer it measures, and SAYS what moved. A
  // silent pass here would be the blind gate the posture document refused.
  const baseline = advisoryBaseline(creditsA, "2026-08-07");
  const checked = assertAdvisoryBaseline(creditsWrapper, baseline);
  assert.deepEqual(
    checked.informationalDrift
      .map((entry) => `${entry.name}.${entry.field}`)
      .sort(),
    [
      "packageA.effects",
      "packageA.fixAvailable",
      "wrapper.effects",
      "wrapper.fixAvailable",
    ],
  );
  for (const entry of checked.informationalDrift) {
    assert.notEqual(entry.baseline, entry.measured);
  }
  assert.deepEqual(
    assertAdvisoryBaseline(creditsA, baseline).informationalDrift,
    [],
  );
});

test("a newly available fix is still reported once attribution leaves the hash", () => {
  // The posture document's standing rule — a fixed release that fits the
  // deployed runtime beats an acceptance — needs to know a fix exists. It is
  // what retired the miniflare and @hono/node-server acceptances, so dropping
  // the field would have traded a flaky gate for a blind one.
  const before = report();
  before.vulnerabilities.packageA.fixAvailable = false;
  const after = report();
  after.vulnerabilities.packageA.fixAvailable = {
    name: "packageA",
    version: "1.9.3",
    isSemVerMajor: false,
  };
  const checked = assertAdvisoryBaseline(
    after,
    advisoryBaseline(before, "2026-08-07"),
  );
  assert.deepEqual(
    checked.informationalDrift.map((entry) => `${entry.name}.${entry.field}`),
    ["packageA.fixAvailable"],
  );
  assert.match(checked.informationalDrift[0].measured, /1\.9\.3/);
});

test("only the two measured-unstable fields sit outside the identity", () => {
  // Loosening this gate has to be a deliberate edit, so the informational set
  // is asserted by name rather than inferred from whatever the entry happens to
  // carry. Everything else npm reports stays inside the hash, including any
  // field it grows tomorrow.
  assert.deepEqual([...INFORMATIONAL_FIELDS], ["effects", "fixAvailable"]);
  const [entry] = normalizeAuditReport(report());
  assert.deepEqual(Object.keys(entry.informational).sort(), [
    "effects",
    "fixAvailable",
  ]);
  assert.deepEqual(Object.keys(advisoryIdentity([entry])[0]), [
    "name",
    "severity",
    "direct",
    "range",
    "via",
    "nodes",
  ]);
});

test("a baseline hashed under the old whole-report schema is refused by name", () => {
  const stale = advisoryBaseline(report(), "2026-08-07");
  stale.schemaVersion = 1;
  assert.throws(
    () => assertAdvisoryBaseline(report(), stale),
    /unsupported schema/,
  );
});

test("repeated GHSA identities with different affected ranges remain distinct", () => {
  const input = report();
  input.vulnerabilities.packageA.via.push({
    ...structuredClone(input.vulnerabilities.packageA.via[0]),
    range: ">=3 <4",
  });
  const [entry] = normalizeAuditReport(input);
  assert.equal(entry.via.length, 2);
  assert.deepEqual(
    entry.via.map((via) => via.range),
    ["<2", ">=3 <4"],
  );
});

test("normalization is invariant to audit map and set ordering", () => {
  const first = normalizeAuditReport(report());
  const reordered = report();
  reordered.vulnerabilities = {
    wrapper: reordered.vulnerabilities.wrapper,
    packageA: reordered.vulnerabilities.packageA,
  };
  reordered.vulnerabilities.packageA.via.push("wrapper");
  reordered.vulnerabilities.packageA.effects.push("another-wrapper");
  reordered.vulnerabilities.packageA.nodes.push(
    "node_modules/tool/node_modules/packageA",
  );
  reordered.vulnerabilities.packageA.via.reverse();
  reordered.vulnerabilities.packageA.effects.reverse();
  reordered.vulnerabilities.packageA.nodes.reverse();

  const canonical = report();
  canonical.vulnerabilities.packageA.via.push("wrapper");
  canonical.vulnerabilities.packageA.effects.push("another-wrapper");
  canonical.vulnerabilities.packageA.nodes.push(
    "node_modules/tool/node_modules/packageA",
  );
  assert.deepEqual(normalizeAuditReport(reordered), normalizeAuditReport(canonical));
  assert.deepEqual(normalizeAuditReport(report()), first);
});

test("malformed or incomplete audit fields fail closed", () => {
  for (const mutate of [
    (next) => {
      delete next.vulnerabilities.packageA.isDirect;
    },
    (next) => {
      delete next.vulnerabilities.packageA.via[0].url;
    },
    (next) => {
      next.vulnerabilities.packageA.via[0].url = "https://example.com/advisory";
    },
    (next) => {
      delete next.vulnerabilities.packageA.via[0].severity;
    },
    (next) => {
      next.vulnerabilities.packageA.fixAvailable.isSemVerMajor = "false";
    },
    (next) => {
      delete next.vulnerabilities.packageA.via[0].dependency;
    },
    (next) => {
      next.metadata.vulnerabilities.high = 1;
    },
    (next) => {
      delete next.metadata.dependencies.peerOptional;
    },
  ]) {
    const next = structuredClone(report());
    mutate(next);
    assert.throws(
      () => normalizeAuditReport(next),
      DependencyAdvisoryPolicyError,
    );
  }
});

test("the checked-in gate is wired through repository tests and CI", () => {
  assert.deepEqual(NPM_AUDIT_ARGS, [
    "audit",
    "--json",
    "--include=prod",
    "--include=dev",
    "--include=optional",
    "--include=peer",
  ]);
  // WIRING IS PER-REPOSITORY, because the baseline is a measurement of ONE
  // dependency graph: it records the tree's resolved graph by sha256, and the
  // public core resolves a different one (no wrangler, no miniflare, no Expo,
  // no Playwright). So each half carries its own baseline and its own posture
  // document, and BOTH halves must run the gate. C0 deferred the public half on
  // "it reports zero advisories today", which is a measurement with no expiry:
  // an unwired gate cannot notice the day that stops being true, and in a
  // public repository the first advisory arrives as a public Dependabot alert
  // with no internal signal ahead of it.
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["advisories:check"],
    "node scripts/check-dependency-advisories.mjs",
  );
  assert.equal(
    pkg.scripts["advisories:test"],
    "node --test scripts/check-dependency-advisories.test.mjs",
  );
  assert.match(pkg.scripts.test, /advisories:test/);
  assert.match(pkg.scripts.test, /advisories:check/);

  const baseline = JSON.parse(
    readFileSync(
      resolve(ROOT, "docs/reference/dependency-advisory-baseline.json"),
      "utf8",
    ),
  );
  const posture = readFileSync(
    resolve(ROOT, "docs/reference/dependency-advisory-posture.md"),
    "utf8",
  );
  assert.match(posture, new RegExp(`Measured ${baseline.measuredAt}`));
  assert.match(
    posture,
    new RegExp(
      `${baseline.vulnerabilities.critical} critical, ` +
        `${baseline.vulnerabilities.high} high, ` +
        `${baseline.vulnerabilities.moderate} moderate, ` +
        `${baseline.vulnerabilities.low} low`,
    ),
  );

  // CI AND DEPENDABOT ARE THE PRIVATE HALF'S ONLY BECAUSE THE PUBLIC HALF HAS
  // NO `.github/` YET. The map places no workflow public, so asserting one here
  // would fail on a file the split has not reached rather than on a gate
  // somebody unwired. What the public half CAN prove is everything above: the
  // gate is wired into its own manifest and its baseline and posture agree.
  const { manifest } = loadOwnership(ROOT);
  if (!holdsPrivateHalf(manifest, ROOT)) return;

  const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /npm run advisories:test/);
  assert.match(ci, /npm run advisories:check/);
  const dependabot = readFileSync(
    resolve(ROOT, ".github/dependabot.yml"),
    "utf8",
  );
  assert.equal(
    dependabot.match(/package-ecosystem: "npm"/g)?.length,
    1,
  );
  assert.equal(
    dependabot.match(/package-ecosystem: "github-actions"/g)?.length,
    1,
  );
});
