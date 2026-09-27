import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  analyzeUnionParity,
  checkSharedUnionParity,
  readAcceptance,
  reconcile,
  subjectFiles,
} from "./check-shared-union-parity.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(REPO_ROOT, "scripts/check-shared-union-parity.mjs");
const ACCEPTANCE = "docs/reference/shared-union-acceptance.json";
const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

/**
 * A repository-shaped fixture: `packages/types/src` for the shared unions and
 * `packages/web/src` for a reader of them, which is the real arrangement.
 */
function repositoryFixture(files, acceptance = { schemaVersion: 1, entries: [] }) {
  const root = mkdtempSync(resolve(tmpdir(), "seorak-union-gate-"));
  temporaryRoots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const destination = resolve(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
  mkdirSync(resolve(root, "docs/reference"), { recursive: true });
  if (acceptance !== null) {
    writeFileSync(resolve(root, ACCEPTANCE), JSON.stringify(acceptance, null, 2));
  }
  return root;
}

const SHARED_UNIONS = `
export type SessionEndReason =
  | "completed"
  | "clear"
  | "logout"
  | "resume"
  | "prompt_input_exit"
  | "other";
export const SESSION_END_REASONS = [
  "completed",
  "clear",
  "logout",
  "resume",
  "prompt_input_exit",
  "other",
] as const;
export interface EndReasonCount {
  reason: SessionEndReason;
  count: number;
}
export interface Snapshot {
  endReasons: EndReasonCount[];
  note: string;
}
`;

/** The exact shape the real bug had: a hand-copied enum behind an unchecked cast. */
function readerSchema(members) {
  return `
import { z } from "zod";
import type { EndReasonCount, Snapshot } from "@seorak/types";

const endReasonSchema: z.ZodType<EndReasonCount> = z.object({
  reason: z.enum([${members.map((member) => JSON.stringify(member)).join(", ")}]),
  count: z.number(),
}) as unknown as z.ZodType<EndReasonCount>;

export const snapshotSchema: z.ZodType<Snapshot> = z.object({
  endReasons: z.array(endReasonSchema),
  note: z.string(),
}) as unknown as z.ZodType<Snapshot>;
`;
}

function fixtureWith(members, acceptance) {
  return repositoryFixture(
    {
      "packages/types/src/index.ts": SHARED_UNIONS,
      "packages/web/src/schema.ts": readerSchema(members),
    },
    acceptance,
  );
}

const ALL_SIX = [
  "completed",
  "clear",
  "logout",
  "resume",
  "prompt_input_exit",
  "other",
];

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], {
    encoding: "utf8",
  });
}

// ---------------------------------------------------------------------------
// The subject is derived, not listed.
// ---------------------------------------------------------------------------

test("the subject is every file that builds a closed value set, found by reading the tree", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/schema.ts": readerSchema(ALL_SIX),
    "packages/web/src/plain.ts": `export const answer = 42;`,
    "apps/mobile/src/later.ts": `
      import { z } from "zod";
      export const kindSchema = z.enum(["a", "b"]);
    `,
    "packages/web/node_modules/vendor/index.ts": `
      import { z } from "zod";
      export const ignored = z.enum(["a"]);
    `,
  });
  const found = subjectFiles(root).map((file) => file.slice(root.length + 1));
  assert.deepEqual(found, ["apps/mobile/src/later.ts", "packages/web/src/schema.ts"]);
});

test("a workspace that does not exist yet is covered the moment it does", () => {
  const before = repositoryFixture({ "packages/types/src/index.ts": SHARED_UNIONS });
  assert.equal(subjectFiles(before).length, 0);
  const after = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/brand-new/src/schema.ts": readerSchema(ALL_SIX),
  });
  assert.equal(subjectFiles(after).length, 1);
});

// ---------------------------------------------------------------------------
// The pairing, and the comparison it makes possible.
// ---------------------------------------------------------------------------

test("a reader that accepts the whole union produces no finding", () => {
  const analysis = analyzeUnionParity(fixtureWith(ALL_SIX));
  assert.deepEqual(analysis.findings, []);
  assert.equal(analysis.checkedCount, 1);
  assert.equal(analysis.sharedCount, 1);
});

test("the original bug: an enum missing two members names the union and both values", () => {
  const analysis = analyzeUnionParity(
    fixtureWith(["completed", "clear", "logout", "prompt_input_exit"]),
  );
  assert.equal(analysis.findings.length, 1);
  const [finding] = analysis.findings;
  assert.equal(finding.category, "narrowed");
  assert.equal(finding.file, "packages/web/src/schema.ts");
  assert.equal(finding.symbol, "endReasonSchema");
  assert.equal(finding.field, ".reason");
  assert.match(finding.evidence, /SessionEndReason/);
  assert.match(finding.evidence, /other/);
  assert.match(finding.evidence, /resume/);
});

test("the `as unknown as` cast that hid the bug from TypeScript does not hide it here", () => {
  // The whole point: this fixture TYPECHECKS. Only the cast makes that possible,
  // and the cast is what this gate reads as the assertion.
  const analysis = analyzeUnionParity(fixtureWith(ALL_SIX.slice(0, 5)));
  assert.equal(analysis.findings[0].category, "narrowed");
});

test("building the enum FROM the union's runtime array cannot drift", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import { SESSION_END_REASONS } from "@seorak/types";
      import type { EndReasonCount } from "@seorak/types";
      export const endReasonSchema: z.ZodType<EndReasonCount> = z.object({
        reason: z.enum(SESSION_END_REASONS).catch("other"),
        count: z.number(),
      }) as unknown as z.ZodType<EndReasonCount>;
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.deepEqual(analysis.findings, []);
  assert.equal(analysis.census[0].memberSource, "const SESSION_END_REASONS");
});

test("a value set reached through an array, a record, and an unannotated sub-schema is still paired", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": `
      export type Fate = "retained" | "overwritten" | "unknown";
      export interface Row { fate: Fate }
      export interface Deep { byDay: Record<string, Row[]> }
    `,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import type { Deep } from "@seorak/types";
      const rowSchema = z.object({ fate: z.enum(["retained", "overwritten"]) });
      export const deepSchema: z.ZodType<Deep> = z.object({
        byDay: z.record(z.string(), z.array(rowSchema)),
      }) as unknown as z.ZodType<Deep>;
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].category, "narrowed");
  assert.match(analysis.findings[0].evidence, /unknown/);
});

test("one arm of a union is compared against its own constituent, not the whole union", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": `
      export interface Unobserved { state: "unobserved"; count: null }
      export interface Observed { state: "observed"; count: number }
      export interface Health { env: Unobserved | Observed }
    `,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import type { Health } from "@seorak/types";
      const unobserved = z.object({ state: z.literal("unobserved"), count: z.null() });
      const observed = z.object({ state: z.literal("observed"), count: z.number() });
      export const healthSchema: z.ZodType<Health> = z.object({
        env: z.union([unobserved, observed]),
      }) as unknown as z.ZodType<Health>;
    `,
  });
  // Without arm matching each `z.literal` would be reported as rejecting the
  // other arm's value, and correct code would need two acceptance entries.
  assert.deepEqual(analyzeUnionParity(root).findings, []);
});

test("a schema WIDER than its contract is not a finding", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import type { EndReasonCount } from "@seorak/types";
      export const s: z.ZodType<EndReasonCount> = z.object({
        reason: z.string(),
        count: z.number(),
      }) as unknown as z.ZodType<EndReasonCount>;
    `,
  });
  assert.deepEqual(analyzeUnionParity(root).findings, []);
});

test("a schema that publishes its own type with z.infer is the union and is not a finding", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/wire.ts": `
      import { z } from "zod";
      export const wireSchema = z.object({ mode: z.enum(["fast", "slow"]) });
      export type Wire = z.infer<typeof wireSchema>;
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.deepEqual(analysis.findings, []);
  assert.equal(analysis.selfDefinedCount, 1);
});

test("z.infer does not excuse a schema a contract root already reaches", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import type { EndReasonCount, Snapshot } from "@seorak/types";
      const endReasonSchema = z.object({
        reason: z.enum(["completed", "clear"]),
        count: z.number(),
      });
      export type Row = z.infer<typeof endReasonSchema>;
      export const snapshotSchema: z.ZodType<Snapshot> = z.object({
        endReasons: z.array(endReasonSchema),
        note: z.string(),
      }) as unknown as z.ZodType<Snapshot>;
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.equal(analysis.findings.length, 1, "the z.infer must not silence the comparison");
  assert.equal(analysis.findings[0].category, "narrowed");
});

test("a value set the walk cannot pair is reported, never skipped", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": SHARED_UNIONS,
    "packages/web/src/orphan.ts": `
      import { z } from "zod";
      export const orphanSchema = z.object({ mode: z.enum(["fast", "slow"]) });
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].category, "unpaired");
  assert.equal(analysis.findings[0].symbol, "orphanSchema");
});

test("closing an open contract is reported so it has to be declared", () => {
  const root = repositoryFixture({
    "packages/types/src/index.ts": `export interface Call { toolName: string }`,
    "packages/web/src/schema.ts": `
      import { z } from "zod";
      import type { Call } from "@seorak/types";
      export const callSchema: z.ZodType<Call> = z.object({
        toolName: z.enum(["Read", "Write"]),
      }) as unknown as z.ZodType<Call>;
    `,
  });
  const analysis = analyzeUnionParity(root);
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].category, "unbounded");
});

test("a member the union no longer has is reported as stray", () => {
  const analysis = analyzeUnionParity(fixtureWith([...ALL_SIX, "teleported_away"]));
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].category, "stray");
  assert.match(analysis.findings[0].evidence, /teleported_away/);
});

// ---------------------------------------------------------------------------
// Reconciliation and the acceptance file.
// ---------------------------------------------------------------------------

test("reconciliation separates accepted, undeclared, and falsified entries", () => {
  const findings = [
    { file: "a.ts", symbol: "s", field: ".x", category: "narrowed", line: 1, evidence: "" },
    { file: "b.ts", symbol: "t", field: ".y", category: "unbounded", line: 2, evidence: "" },
  ];
  const entries = [
    {
      file: "a.ts",
      symbol: "s",
      field: ".x",
      category: "narrowed",
      acceptedOn: "2026-08-07",
      why: "w",
      falsifiedWhen: "f",
    },
    {
      file: "gone.ts",
      symbol: "u",
      field: ".z",
      category: "narrowed",
      acceptedOn: "2026-08-07",
      why: "w",
      falsifiedWhen: "f",
    },
  ];
  const { accepted, undeclared, stale } = reconcile(findings, entries);
  assert.equal(accepted.length, 1);
  assert.equal(undeclared.length, 1);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].file, "gone.ts");
});

test("an acceptance entry without a falsification condition is rejected", () => {
  const root = repositoryFixture(
    { "packages/types/src/index.ts": SHARED_UNIONS },
    {
      schemaVersion: 1,
      entries: [
        {
          file: "a.ts",
          symbol: "s",
          field: ".x",
          category: "narrowed",
          acceptedOn: "2026-08-07",
          why: "because",
        },
      ],
    },
  );
  const { entries, problems } = readAcceptance(root, ACCEPTANCE);
  assert.equal(entries.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /falsifiedWhen/);
});

test("an acceptance entry with an unknown category is rejected", () => {
  const root = repositoryFixture(
    { "packages/types/src/index.ts": SHARED_UNIONS },
    {
      schemaVersion: 1,
      entries: [
        {
          file: "a.ts",
          symbol: "s",
          field: ".x",
          category: "vibes",
          acceptedOn: "2026-08-07",
          why: "because",
          falsifiedWhen: "never",
        },
      ],
    },
  );
  const { problems } = readAcceptance(root, ACCEPTANCE);
  assert.match(problems[0], /unknown category vibes/);
});

// ---------------------------------------------------------------------------
// The executable: enforcement with no flag to remember.
// ---------------------------------------------------------------------------

test("an undeclared narrowing fails with a non-zero exit naming the union and the member", () => {
  const root = fixtureWith(ALL_SIX.filter((member) => member !== "resume"));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Undeclared narrowings \(1\)/);
  assert.match(result.stdout, /SessionEndReason/);
  assert.match(result.stdout, /rejects resume/);
});

test("the census prints the pairing and still fails", () => {
  const root = fixtureWith(ALL_SIX.filter((member) => member !== "resume"));
  const result = run(root, "--census");
  assert.equal(result.status, 1, "a reporting flag must not silence the gate");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.census[0].union, "SessionEndReason");
});

test("accepting the planted narrowing clears the check again", () => {
  const root = fixtureWith(ALL_SIX.filter((member) => member !== "resume"), {
    schemaVersion: 1,
    entries: [
      {
        file: "packages/web/src/schema.ts",
        symbol: "endReasonSchema",
        field: ".reason",
        category: "narrowed",
        acceptedOn: "2026-08-07",
        why: "this reader deliberately handles five of the six",
        falsifiedWhen: "the reader starts rendering resumed sessions",
      },
    ],
  });
  const result = run(root);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Accepted narrowings \(1\)/);
});

test("an acceptance entry that no longer matches any narrowing fails", () => {
  const root = fixtureWith(ALL_SIX, {
    schemaVersion: 1,
    entries: [
      {
        file: "packages/web/src/schema.ts",
        symbol: "endReasonSchema",
        field: ".reason",
        category: "narrowed",
        acceptedOn: "2026-08-07",
        why: "was true once",
        falsifiedWhen: "the enum accepts all six again",
      },
    ],
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no matching narrowing \(1\)/);
  assert.match(result.stdout, /is falsified, remove it/);
});

test("a missing acceptance file fails rather than degrading to no coverage", () => {
  const root = repositoryFixture(
    {
      "packages/types/src/index.ts": SHARED_UNIONS,
      "packages/web/src/schema.ts": readerSchema(ALL_SIX),
    },
    null,
  );
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /acceptance file: .* is missing/);
});

test("a malformed acceptance file fails rather than degrading to no coverage", () => {
  const root = fixtureWith(ALL_SIX);
  writeFileSync(resolve(root, ACCEPTANCE), "{ not json");
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /is not valid JSON/);
});

// ---------------------------------------------------------------------------
// This repository.
// ---------------------------------------------------------------------------

test("the committed acceptance file parses and none of its entries is falsified", () => {
  const { entries, problems } = readAcceptance(REPO_ROOT);
  assert.deepEqual(problems, []);
  assert.ok(entries.length > 0, "an empty file would mean the gate excuses nothing");
  const { stale } = checkSharedUnionParity(REPO_ROOT).reconciliation;
  assert.deepEqual(
    stale.map((entry) => `${entry.file} ${entry.symbol}${entry.field}`),
    [],
  );
});
