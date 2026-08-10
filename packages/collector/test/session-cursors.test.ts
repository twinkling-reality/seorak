import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionCursorDatabasePath } from "../src/paths.ts";
import {
  deleteSessionCursor,
  migrateLegacySessionCursors,
  readSessionCursor,
  writeSessionCursor,
} from "../src/session-cursors.ts";

let dir: string;
let savedDir: string | undefined;

beforeEach(() => {
  savedDir = process.env.SEORAK_DIR;
  dir = mkdtempSync(join(tmpdir(), "seorak-session-cursors-"));
  process.env.SEORAK_DIR = dir;
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("transactional session cursor store", () => {
  it("migrates hundreds of transcript and git cursor inodes into one database", () => {
    for (let index = 0; index < 568; index += 1) {
      writeFileSync(join(dir, `cursor-session-${index}`), `uuid-${index}`, "utf8");
    }
    for (let index = 0; index < 22; index += 1) {
      writeFileSync(
        join(dir, `gitcursor-session-${index}`),
        JSON.stringify({
          startSha: `sha-${index}`,
          startGitContext: "branch",
          startBranch: "main",
        }),
        "utf8",
      );
    }

    const result = migrateLegacySessionCursors();
    expect(result).toEqual({
      discovered: 590,
      imported: 590,
      removed: 590,
      retained: 0,
      skipped: 0,
    });
    expect(
      readdirSync(dir).filter(
        (name) => name.startsWith("cursor-") || name.startsWith("gitcursor-"),
      ),
    ).toEqual([]);

    const database = new DatabaseSync(sessionCursorDatabasePath());
    try {
      const row = database
        .prepare("SELECT count(*) AS count FROM session_cursor")
        .get() as { count: number };
      expect(row.count).toBe(590);
    } finally {
      database.close();
    }
  });

  it("keeps never-ended git state in the database and consumes it explicitly", () => {
    const value = JSON.stringify({
      startSha: "abc",
      startGitContext: "branch",
      startBranch: "main",
    });
    writeSessionCursor("git", "session-live", value);

    expect(readSessionCursor("git", "session-live")).toBe(value);
    expect(existsSync(join(dir, "gitcursor-session-live"))).toBe(false);
    deleteSessionCursor("git", "session-live");
    expect(readSessionCursor("git", "session-live")).toBeNull();
  });

  it("fails closed on a future database schema instead of resetting cursors", () => {
    writeSessionCursor("transcript", "session-a", "uuid-a");
    const database = new DatabaseSync(sessionCursorDatabasePath());
    database.exec("PRAGMA user_version = 2");
    database.close();

    expect(() => readSessionCursor("transcript", "session-a")).toThrow(
      "unsupported session cursor database version 2",
    );
  });

  it("retains malformed legacy cursor files for manual recovery", () => {
    writeFileSync(join(dir, "cursor-empty"), "", "utf8");
    const result = migrateLegacySessionCursors();
    expect(result).toEqual({
      discovered: 1,
      imported: 0,
      removed: 0,
      retained: 0,
      skipped: 1,
    });
    expect(existsSync(join(dir, "cursor-empty"))).toBe(true);
    expect(existsSync(sessionCursorDatabasePath())).toBe(false);
  });
});
