import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  analyzePublishSafety,
  checkTypesPublishSafety,
  readAcceptance,
  reconcile,
} from "./check-types-publish-safety.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(REPO_ROOT, "scripts/check-types-publish-safety.mjs");
const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

/** A bare source root, analysed directly. */
function sourceRoot(files) {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-types-gate-"));
  temporaryRoots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const destination = resolve(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
  return root;
}

/** A repository-shaped fixture the executable itself can be pointed at. */
function repositoryFixture(files, acceptance = { schemaVersion: 1, entries: [] }) {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-types-repo-"));
  temporaryRoots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const destination = resolve(root, "packages/types/src", path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
  mkdirSync(resolve(root, "docs/reference"), { recursive: true });
  writeFileSync(
    resolve(root, "docs/reference/types-boundary-acceptance.json"),
    JSON.stringify(acceptance, null, 2),
  );
  return root;
}

function findingsFor(files) {
  return analyzePublishSafety(sourceRoot(files))
    .findings.map((finding) => `${finding.symbol} [${finding.category}]`)
    .sort();
}

// ---------------------------------------------------------------------------
// The subject: data is never the subject, however large.
// ---------------------------------------------------------------------------

test("catalogs, thresholds, and price tables are not the subject of any clause", () => {
  assert.deepEqual(
    findingsFor({
      "catalog.ts": `
        export interface Threshold { key: string; default: number }
        export const DEFAULT_THRESHOLDS = { costSpikeUsd: 5, longSessionMinutes: 90 };
        export const MODEL_PRICES: Record<string, { in: number; out: number } | null> = {
          "claude-opus-5": { in: 15, out: 75 },
          "retired-model": null,
        };
        export const SIGNAL_IDS = ["cost_spike", "went_cold"] as const;
        export type SignalId = (typeof SIGNAL_IDS)[number];
      `,
    }),
    [],
  );
});

test("wire helpers that assemble a contract from their input are publish safe", () => {
  assert.deepEqual(
    findingsFor({
      "api.ts": `
        export const seorakRoutes = { overview: "/overview" } as const;
        export function bearerHeader(token: string): Record<string, string> {
          return { Authorization: \`Bearer \${token}\` };
        }
        export function conditionalGetHeaders(etag: string | null): Record<string, string> {
          return etag ? { "If-None-Match": etag } : {};
        }
      `,
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// EXTRACTION
// ---------------------------------------------------------------------------

test("recovering fields from frozen prose is extraction", () => {
  assert.deepEqual(
    findingsFor({
      "bodies.ts": `
        export interface Claim { costUsd: number; capUsd: number }
        export function parseBody(body: string): Claim | null {
          const m = body.match(/^Spent \\$([\\d.]+) past \\$([\\d.]+)\\.$/);
          return m ? { costUsd: Number(m[1]), capUsd: Number(m[2]) } : null;
        }
      `,
    }),
    ["parseBody [extraction]"],
  );
});

test("predicates, formatters, and normalisers over text are not extraction", () => {
  assert.deepEqual(
    findingsFor({
      "text.ts": `
        export interface Identity { id: string; label: string }
        export function looksLikeIso(value: string): boolean {
          return /^\\d{4}-\\d{2}-\\d{2}/.test(value);
        }
        export function titleCase(value: string): string {
          return value.replace(/\\b\\w/g, (c) => c.toUpperCase());
        }
        export function resolveIdentity(toolId: string): Identity {
          return { id: toolId, label: toolId.replace(/[-_]/g, " ") };
        }
      `,
    }),
    [],
  );
});

test("reading back a shape the same file encodes is a round trip, not extraction", () => {
  assert.deepEqual(
    findingsFor({
      "bodies.ts": `
        export interface Claim { costUsd: number; capUsd: number }
        export function buildBody(claim: Claim): string {
          return \`Spent $\${claim.costUsd} past $\${claim.capUsd}.\`;
        }
        export function parseBody(body: string): Claim | null {
          const m = body.match(/^Spent \\$([\\d.]+) past \\$([\\d.]+)\\.$/);
          return m ? { costUsd: Number(m[1]), capUsd: Number(m[2]) } : null;
        }
      `,
    }),
    [],
  );
});

test("the round trip clears only the shape its own file encodes", () => {
  assert.deepEqual(
    findingsFor({
      "mixed.ts": `
        export interface Claim { costUsd: number }
        export interface AgentLine { tool: string; exitCode: number }
        export function buildBody(claim: Claim): string {
          return \`Spent $\${claim.costUsd}.\`;
        }
        export function parseAgentLine(line: string): AgentLine | null {
          const m = line.match(/^(\\S+) exited (\\d+)$/);
          return m ? { tool: m[1]!, exitCode: Number(m[2]) } : null;
        }
      `,
    }),
    ["parseAgentLine [extraction]"],
  );
});

test("an encoder in another file does not clear a decoder", () => {
  assert.deepEqual(
    findingsFor({
      "shape.ts": `
        export interface Claim { costUsd: number }
        export function buildBody(claim: Claim): string {
          return \`Spent $\${claim.costUsd}.\`;
        }
      `,
      "read.ts": `
        import type { Claim } from "./shape.ts";
        export function parseBody(body: string): Claim | null {
          const m = body.match(/^Spent \\$([\\d.]+)\\.$/);
          return m ? { costUsd: Number(m[1]) } : null;
        }
      `,
    }),
    ["parseBody [extraction]"],
  );
});

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

test("deriving a number from measured input and returning it is scoring", () => {
  assert.deepEqual(
    findingsFor({
      "price.ts": `
        export interface Usage { inputTokens: number; outputTokens: number }
        export function priceUsage(usage: Usage): { costUsd: number } {
          const total = usage.inputTokens * 3 + usage.outputTokens * 15;
          return { costUsd: total / 1_000_000 };
        }
      `,
    }),
    ["priceUsage [scoring]"],
  );
});

test("size, counting, ordering, and arithmetic that only reaches prose are not scoring", () => {
  assert.deepEqual(
    findingsFor({
      "shape.ts": `
        export function decodedBytes(value: string): number {
          return (value.length / 4) * 3 - (value.endsWith("=") ? 1 : 0);
        }
        export function countItems(items: readonly string[]): number {
          let count = 0;
          for (const item of items) count += item.length > 0 ? 1 : 0;
          return count;
        }
        export function newestFirst(rows: readonly { at: string }[]): { at: string }[] {
          return [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        }
        export function formatElapsed(seconds: number): string {
          return \`\${Math.floor(seconds / 60)}m\`;
        }
      `,
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// EVALUATION
// ---------------------------------------------------------------------------

test("comparing a measured value against a threshold is evaluation", () => {
  assert.deepEqual(
    findingsFor({
      "burn.ts": `
        export interface State { elapsedSeconds: number; costUsd: number }
        export function summarize(state: State): { burnRateUsdPerMin: number | null } {
          const minutes = state.elapsedSeconds / 60;
          return { burnRateUsdPerMin: minutes > 0 ? state.costUsd / minutes : null };
        }
      `,
    }),
    ["summarize [evaluation]", "summarize [scoring]"].sort(),
  );
});

test("protocol range checks, rejection guards, and predicates are not evaluation", () => {
  assert.deepEqual(
    findingsFor({
      "guards.ts": `
        export type Outcome = "ok" | "notModified" | "error";
        export function classifyWorkerStatus(status: number): Outcome {
          if (status === 304) return "notModified";
          if (status >= 200 && status < 300) return "ok";
          return "error";
        }
        export function isCount(value: unknown, max: number): boolean {
          return typeof value === "number" && value >= 0 && value <= max;
        }
        export interface Row { sequence: number; at: string }
        export function parseRow(value: { sequence: number; at: string }): Row | null {
          if (value.sequence > 1_000_000) return null;
          return value;
        }
      `,
    }),
    [],
  );
});

test("choosing between published constants is evaluation, a keyed lookup is not", () => {
  assert.deepEqual(
    findingsFor({
      "policy.ts": `
        export interface Caps { sync: boolean }
        export const NO_CAPS: Caps = { sync: false };
        export const PRO_CAPS: Caps = { sync: true };
        export const REGISTRY: Record<string, Caps> = { free: NO_CAPS, pro: PRO_CAPS };
        export function expectedFor(plan: "free" | "pro", state: "active" | "past_due"): Caps {
          if (state === "past_due") return NO_CAPS;
          if (plan === "pro") return PRO_CAPS;
          return NO_CAPS;
        }
        export function registered(plan: string): Caps {
          return REGISTRY[plan] ?? NO_CAPS;
        }
      `,
    }),
    ["expectedFor [evaluation]"],
  );
});

// ---------------------------------------------------------------------------
// PROPAGATION
// ---------------------------------------------------------------------------

test("an exported wrapper carries the finding of the body it wraps", () => {
  const findings = analyzePublishSafety(
    sourceRoot({
      "wrap.ts": `
        export interface Caps { sync: boolean }
        const NO_CAPS: Caps = { sync: false };
        const PRO_CAPS: Caps = { sync: true };
        function expectedFor(plan: "free" | "pro"): Caps {
          if (plan === "pro") return PRO_CAPS;
          return NO_CAPS;
        }
        export function capabilitiesForAuthority(plan: "free" | "pro"): Caps {
          return { ...expectedFor(plan) };
        }
      `,
    }),
  ).findings;
  const wrapper = findings.find((f) => f.symbol === "capabilitiesForAuthority");
  assert.equal(wrapper?.category, "evaluation");
  assert.match(wrapper.origin, /^calls expectedFor /);
});

// ---------------------------------------------------------------------------
// Acceptance reconciliation
// ---------------------------------------------------------------------------

test("reconciliation separates accepted, undeclared, and falsified entries", () => {
  const findings = [
    { file: "a.ts", symbol: "one", category: "scoring", line: 1, evidence: "", origin: "direct" },
    { file: "a.ts", symbol: "two", category: "extraction", line: 2, evidence: "", origin: "direct" },
  ];
  const entries = [
    { file: "a.ts", symbol: "one", category: "scoring", acceptedOn: "x", why: "y", falsifiedWhen: "z" },
    { file: "a.ts", symbol: "gone", category: "evaluation", acceptedOn: "x", why: "y", falsifiedWhen: "z" },
  ];
  const { accepted, undeclared, stale } = reconcile(findings, entries);
  assert.deepEqual(accepted.map((f) => f.symbol), ["one"]);
  assert.deepEqual(undeclared.map((f) => f.symbol), ["two"]);
  assert.deepEqual(stale.map((e) => e.symbol), ["gone"]);
});

test("an acceptance entry without a falsification condition is rejected", () => {
  const root = repositoryFixture(
    { "leaf.ts": "export const A = 1;" },
    {
      schemaVersion: 1,
      entries: [{ file: "a.ts", symbol: "one", category: "scoring", acceptedOn: "x", why: "y" }],
    },
  );
  const { entries, problems } = readAcceptance(root);
  assert.deepEqual(entries, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /falsifiedWhen/);
});

// ---------------------------------------------------------------------------
// The executable, on a deliberately planted violation
// ---------------------------------------------------------------------------

const PLANTED = `
  export interface Claim { minutes: number }
  export function plantedExtractor(body: string): Claim | null {
    const m = body.match(/^Ran for (\\d+) minutes\\.$/);
    return m ? { minutes: Number(m[1]) } : null;
  }
`;

function run(root, ...flags) {
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...flags], {
    encoding: "utf8",
  });
}

test("an undeclared placement fails with no flag to remember", () => {
  const root = repositoryFixture({ "planted.ts": PLANTED });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Undeclared placements \(1\)/);
  assert.match(result.stdout, /plantedExtractor \[extraction\]/);
});

// `--census` is a reporting flag. If it also suppressed the exit code it would
// be an undocumented way to wire a green nothing into CI, which is the defect
// this gate spent a stage fixing.
test("the census prints its own output and still fails", () => {
  const root = repositoryFixture({ "planted.ts": PLANTED });
  const result = run(root, "--census");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"symbol": "plantedExtractor"/);
});

test("accepting the planted violation clears the check again", () => {
  const root = repositoryFixture(
    { "planted.ts": PLANTED },
    {
      schemaVersion: 1,
      entries: [
        {
          file: "packages/types/src/planted.ts",
          symbol: "plantedExtractor",
          category: "extraction",
          acceptedOn: "2026-08-04",
          why: "fixture",
          falsifiedWhen: "the fixture is deleted",
        },
      ],
    },
  );
  assert.equal(run(root).status, 0);
});

test("an acceptance entry that no longer matches any placement fails", () => {
  const root = repositoryFixture(
    { "leaf.ts": "export const A = 1;" },
    {
      schemaVersion: 1,
      entries: [
        {
          file: "packages/types/src/gone.ts",
          symbol: "gone",
          category: "scoring",
          acceptedOn: "2026-08-04",
          why: "fixture",
          falsifiedWhen: "now",
        },
      ],
    },
  );
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /is falsified, remove it/);
});

test("a malformed acceptance file fails rather than degrading to no coverage", () => {
  const root = repositoryFixture({ "leaf.ts": "export const A = 1;" }, { schemaVersion: 99 });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unsupported schema version/);
});

// ---------------------------------------------------------------------------
// This repository
// ---------------------------------------------------------------------------

test("the committed acceptance file parses and none of its entries is falsified", () => {
  const { reconciliation, problems } = checkTypesPublishSafety(REPO_ROOT);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    reconciliation.stale.map((entry) => `${entry.file} ${entry.symbol}`),
    [],
  );
});
