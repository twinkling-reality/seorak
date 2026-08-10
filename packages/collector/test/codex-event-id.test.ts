/**
 * codex-event-id.test.ts — the deterministic id primitive for Codex rollout rows
 * (the precondition that makes a re-tailing daemon safe). Contracts under test:
 *
 *   - same (sessionId, rolloutFileName, byteOffset) => same 64-hex id, always;
 *   - re-tailing the SAME rows a second time yields an IDENTICAL id list, so a
 *     Set keyed on event_id (the model of the worker's `INSERT OR IGNORE` on the
 *     event_id PK) gains NOTHING on the second pass — the re-tail is a no-op;
 *   - distinct rows (different offset / session / file) => distinct ids;
 *   - the compaction-reset hazard is avoided: two rows that share a cumulative
 *     token value but sit at different byte offsets get DIFFERENT ids, because
 *     the anchor is the offset, never the (repeating) cumulative value;
 *   - the id is an opaque hash: the raw sessionId / filename never appear in it.
 *
 * fs-sandboxed: SEORAK_DIR points at a temp dir so the machine salt lives in a
 * sandbox (never the real ~/.seorak) and stays stable for the whole run, which
 * is the determinism precondition the primitive assumes. Same pattern as
 * file-id.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codexRolloutEventId } from "../src/codex-event-id.ts";

let sandbox: string;
const savedDir = process.env.SEORAK_DIR;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-codexid-"));
  process.env.SEORAK_DIR = sandbox;
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
});

// A stand-in rollout tail: real files are one JSON object per line, so each row
// has a byte offset (the file position of its line start). `cumTokens` mirrors a
// `token_count` row's cumulative total; it exists ONLY so the reset-immunity
// test can reuse a value across two rows. It is deliberately NOT an id input.
type Row = { offset: number; cumTokens: number };

const FILE = "rollout-2026-07-06T07-52-42-019f3746-0230-7420-a3d8-a63e4abfb748.jsonl";
const SESSION = "019f3746-0230-7420-a3d8-a63e4abfb748";

// Four rows, two of which share cumTokens=11281077 — the exact collision observed
// in a real rollout (lines 546/547/557/562), where the cumulative total plateaus
// across distinct rows.
const ROWS: Row[] = [
  { offset: 0, cumTokens: 16029 },
  { offset: 4821, cumTokens: 11281077 },
  { offset: 5140, cumTokens: 11281077 },
  { offset: 9007, cumTokens: 11299004 },
];

const tail = (rows: Row[], session = SESSION, file = FILE): string[] =>
  rows.map((r) => codexRolloutEventId(session, file, r.offset));

describe("codexRolloutEventId — determinism", () => {
  it("same inputs => same 64-hex id, on repeat", () => {
    const a = codexRolloutEventId(SESSION, FILE, 4821);
    const b = codexRolloutEventId(SESSION, FILE, 4821);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
});

describe("codexRolloutEventId — re-tail idempotency (the whole point)", () => {
  it("a second tail pass over the same rows adds NOTHING to the event_id set", () => {
    const pass1 = tail(ROWS);
    const pass2 = tail(ROWS);

    // The re-emitted ids are element-for-element identical.
    expect(pass2).toEqual(pass1);

    // Model the worker's `INSERT OR IGNORE INTO events (... event_id ...)` as a
    // Set keyed on event_id: first tail inserts, second tail is a pure re-check.
    const table = new Set<string>();
    for (const id of pass1) table.add(id);
    const sizeAfterFirstTail = table.size;
    for (const id of pass2) table.add(id);
    const sizeAfterRetail = table.size;

    expect(sizeAfterFirstTail).toBe(ROWS.length); // every distinct row landed
    expect(sizeAfterRetail).toBe(sizeAfterFirstTail); // re-tail collapsed to a no-op
  });
});

describe("codexRolloutEventId — distinctness (no accidental collisions)", () => {
  it("different byte offset => different id", () => {
    expect(codexRolloutEventId(SESSION, FILE, 4821)).not.toBe(
      codexRolloutEventId(SESSION, FILE, 5140),
    );
  });

  it("different session or file => different id at the same offset", () => {
    const base = codexRolloutEventId(SESSION, FILE, 0);
    expect(base).not.toBe(codexRolloutEventId("other-session", FILE, 0));
    expect(base).not.toBe(codexRolloutEventId(SESSION, "rollout-other.jsonl", 0));
  });

  it("a realistic batch maps to as many distinct ids as there are rows", () => {
    const ids = tail(ROWS);
    expect(new Set(ids).size).toBe(ROWS.length);
  });
});

describe("codexRolloutEventId — compaction-reset immunity", () => {
  it("two rows sharing a cumulative token value get DIFFERENT ids", () => {
    // ROWS[1] and ROWS[2] both carry cumTokens=11281077. Anchoring on that value
    // would collide them under INSERT OR IGNORE and drop one; anchoring on the
    // byte offset keeps them distinct.
    const [, a, b] = ROWS;
    expect(a.cumTokens).toBe(b.cumTokens); // the hazard is real in the fixture
    expect(codexRolloutEventId(SESSION, FILE, a.offset)).not.toBe(
      codexRolloutEventId(SESSION, FILE, b.offset),
    );
  });
});

describe("codexRolloutEventId — opaque (capture principle)", () => {
  it("the raw session id and filename never appear in the id", () => {
    const id = codexRolloutEventId(SESSION, FILE, 4821);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain(SESSION);
    expect(id).not.toContain(FILE);
    expect(id).not.toContain("rollout");
  });
});
