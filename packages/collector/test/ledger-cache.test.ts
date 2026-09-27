import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyLedger,
  loadLedger,
  resetLedgerCache,
  saveLedger,
  syncLedger,
} from "../src/ledger.ts";
import { ledgerBackupPath, ledgerPath } from "../src/paths.ts";

let saved: string | undefined;
const made: string[] = [];

function useDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "seorak-ledger-cache-"));
  made.push(dir);
  process.env.SEORAK_DIR = dir;
  return dir;
}

beforeEach(() => {
  saved = process.env.SEORAK_DIR;
  resetLedgerCache();
});

afterEach(() => {
  if (saved === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = saved;
  resetLedgerCache();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("saveLedger rotation", () => {
  it("still refuses to promote a torn current file to backup by default", () => {
    useDirectory();
    const first = emptyLedger();
    first.offset = 10;
    expect(saveLedger(first)).toBe(true);

    // A current file that cannot be parsed must not become the fallback: the
    // whole point of the backup is that it is known-good.
    writeFileSync(ledgerPath(), "{torn", "utf8");
    const second = emptyLedger();
    second.offset = 20;
    expect(saveLedger(second)).toBe(true);
    expect(existsSync(ledgerBackupPath())).toBe(false);
    expect(JSON.parse(readFileSync(ledgerPath(), "utf8")).offset).toBe(20);
  });

  it("rotates normally when the caller vouches for the current file", () => {
    useDirectory();
    const first = emptyLedger();
    first.offset = 10;
    expect(saveLedger(first)).toBe(true);

    const second = emptyLedger();
    second.offset = 20;
    // The caller wrote and fsynced the current file, so the re-parse is skipped.
    // The rotation itself must be unchanged.
    expect(saveLedger(second, true)).toBe(true);
    expect(JSON.parse(readFileSync(ledgerBackupPath(), "utf8")).offset).toBe(10);
    expect(JSON.parse(readFileSync(ledgerPath(), "utf8")).offset).toBe(20);
  });
});

describe("the working-ledger cache", () => {
  it("does not carry one directory's ledger into another", async () => {
    const first = useDirectory();
    writeFileSync(join(first, "events.jsonl"), "");
    const a = await syncLedger(Date.now());
    a.agents["from-first"] = "claude-code";

    // A new SEORAK_DIR is a different ledger. A cache that ignored the path
    // would hand this one the previous directory's offsets and agents.
    const second = useDirectory();
    expect(second).not.toBe(first);
    writeFileSync(join(second, "events.jsonl"), "");
    const b = await syncLedger(Date.now());
    expect(b.agents["from-first"]).toBeUndefined();
  });

  it("leaves loadLedger reading disk, because it is the recovery path", () => {
    useDirectory();
    const first = emptyLedger();
    first.offset = 10;
    expect(saveLedger(first)).toBe(true);
    const second = emptyLedger();
    second.offset = 20;
    expect(saveLedger(second)).toBe(true);

    // Corrupt the current file. loadLedger must still fall back to the previous
    // durable checkpoint rather than answering from anything held in memory.
    writeFileSync(ledgerPath(), "{torn", "utf8");
    expect(loadLedger().offset).toBe(10);
  });
});
