import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rotateDaemonLogIfNeeded } from "../src/daemon-log.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seorak-daemon-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("launchd-compatible daemon log rotation", () => {
  it("is an honest no-op when the log is absent or at the limit", () => {
    const logPath = join(dir, "daemon.log");
    const archivePath = join(dir, "daemon.log.1");
    expect(
      rotateDaemonLogIfNeeded({ logPath, archivePath, maxBytes: 6 }),
    ).toEqual({ rotated: false, bytesArchived: 0, bytesDiscarded: 0 });

    writeFileSync(logPath, "123456", "utf8");
    expect(
      rotateDaemonLogIfNeeded({ logPath, archivePath, maxBytes: 6 }),
    ).toEqual({ rotated: false, bytesArchived: 0, bytesDiscarded: 0 });
    expect(existsSync(archivePath)).toBe(false);
  });

  it("copy-truncates the exact inode so a launchd-held descriptor keeps writing daemon.log", () => {
    const logPath = join(dir, "daemon.log");
    const archivePath = join(dir, "daemon.log.1");
    const heldByLaunchd = openSync(logPath, "a", 0o600);
    try {
      writeSync(heldByLaunchd, "abcdefghij");
      const before = lstatSync(logPath);

      expect(
        rotateDaemonLogIfNeeded({ logPath, archivePath, maxBytes: 6 }),
      ).toEqual({ rotated: true, bytesArchived: 6, bytesDiscarded: 4 });
      const after = lstatSync(logPath);
      expect({ dev: after.dev, ino: after.ino }).toEqual({
        dev: before.dev,
        ino: before.ino,
      });
      expect(readFileSync(archivePath, "utf8")).toBe("efghij");
      expect(readFileSync(logPath, "utf8")).toBe("");

      writeSync(heldByLaunchd, "new-line\n");
    } finally {
      closeSync(heldByLaunchd);
    }
    expect(readFileSync(logPath, "utf8")).toBe("new-line\n");
    expect(readFileSync(archivePath, "utf8")).toBe("efghij");
  });

  it("never truncates when the recoverable archive cannot be published", () => {
    const logPath = join(dir, "daemon.log");
    const archivePath = join(dir, "daemon.log.1");
    writeFileSync(logPath, "abcdefghij", "utf8");
    mkdirSync(archivePath);

    expect(() =>
      rotateDaemonLogIfNeeded({ logPath, archivePath, maxBytes: 6 }),
    ).toThrow();
    expect(readFileSync(logPath, "utf8")).toBe("abcdefghij");
    expect(
      readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
