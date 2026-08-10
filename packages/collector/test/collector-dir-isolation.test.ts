/**
 * Pins the suite-wide isolation that `test/support/isolate-collector-dir.ts`
 * provides, rather than trusting that it is still wired up.
 *
 * This file deliberately never sets `SEORAK_DIR` itself. It is therefore the
 * exact shape of the mistake it guards: a test file that reaches for collector
 * state without sandboxing it. Under the mechanism that lands in a directory
 * only this file can name; without it, in the `~/.seorak` of whoever ran the
 * suite, shared with every other such file and with their running collector.
 *
 * Delete the `setupFiles` entry from vitest.config.ts and this fails
 * deterministically, on every machine, rather than intermittently under load.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectorDir, eventsLogPath, repoSaltPath } from "../src/paths.ts";

const realCollectorDir = resolve(join(homedir(), ".seorak"));

describe("every test file gets its own collector directory", () => {
  it("does not resolve the shared default, even though this file never set SEORAK_DIR", () => {
    expect(process.env.SEORAK_DIR).toBeTruthy();
    expect(collectorDir()).not.toBe(realCollectorDir);
    // Under the developer's home is the failure being excluded, not just that
    // one exact path: a sandbox nested inside it would still be shared state.
    expect(collectorDir().startsWith(realCollectorDir)).toBe(false);
  });

  it("resolves somewhere disposable, so an abandoned write cannot outlive the run", () => {
    // realpath on both sides: macOS hands out /var/folders/... for tmpdir()
    // while collectorDir() canonicalizes to /private/var/folders/..., so a raw
    // prefix compare would fail on a directory that is in fact under tmp.
    expect(collectorDir().startsWith(realpathSync(resolve(tmpdir())))).toBe(true);
  });

  it("routes the state files that were measured leaking into the real directory", () => {
    // repo-salt and last-seen-version are the read-modify-write files whose
    // CONTENT selects a branch, so a shared copy is a wrong-value failure rather
    // than a slow one. events.jsonl is what a leaked async append lands in.
    for (const path of [repoSaltPath(), eventsLogPath()]) {
      expect(path.startsWith(realCollectorDir)).toBe(false);
      expect(path.startsWith(collectorDir())).toBe(true);
    }
  });

  it("is writable, and a write lands in the sandbox rather than the real directory", () => {
    // Named after THIS run's sandbox, so the check can only ever observe the
    // write below. A fixed name would fail on any machine where an earlier run
    // without the mechanism had already dropped one in the real directory,
    // which is a stale artifact rather than a live leak, and it would keep
    // failing until someone deleted a file by hand.
    const name = `isolation-marker-${basename(collectorDir())}`;
    writeFileSync(join(collectorDir(), name), "isolated", "utf8");
    expect(readFileSync(join(collectorDir(), name), "utf8")).toBe("isolated");
    expect(existsSync(join(realCollectorDir, name))).toBe(false);
  });
});
