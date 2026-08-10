import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireCollectorLifecycleLock,
  acquireDaemonLease,
  acquireHookCaptureLease,
  activateCollectorState,
  advanceCollectorPurge,
  assertCollectorCanInitialize,
  beginCollectorPurge,
  claimCollectorState,
  collectorCaptureRevoked,
  daemonLeaseStatus,
  hookCaptureLeaseStatus,
  planCollectorPurge,
  purgeCollectorStateDirectory,
  resolveCollectorLifecyclePaths,
  type CollectorLifecyclePaths,
  type LifecycleEnvironment,
} from "../src/collector-lifecycle.ts";

let root: string;
let home: string;
let cwd: string;
let control: string;
let environment: LifecycleEnvironment;

function paths(stateDir: string): CollectorLifecyclePaths {
  return resolveCollectorLifecyclePaths(stateDir, environment);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "seorak-lifecycle-"));
  home = join(root, "home");
  cwd = join(root, "workspace");
  control = join(root, "control");
  mkdirSync(home);
  mkdirSync(cwd);
  environment = { homeDir: home, cwd, controlDir: control };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collector lifecycle path safety", () => {
  it("requires absolute state and control directories", () => {
    expect(() =>
      resolveCollectorLifecyclePaths("relative/state", environment),
    ).toThrow(/SEORAK_DIR must be an absolute path/);
    expect(() =>
      resolveCollectorLifecyclePaths(join(root, "state"), {
        ...environment,
        controlDir: "relative/control",
      }),
    ).toThrow(/absolute path/);
  });

  it.each([
    ["filesystem root", "/"],
    ["home", () => home],
    ["home ancestor", () => root],
    ["workspace", () => cwd],
  ])("refuses %s as a purge target", (_label, value) => {
    const target = typeof value === "function" ? value() : value;
    expect(() => planCollectorPurge(paths(target), environment)).toThrow(
      /unsafe collector state path/,
    );
  });

  it("refuses a symlink target without following it", () => {
    const real = join(root, "real-state");
    const linked = join(root, "linked-state");
    mkdirSync(real);
    symlinkSync(real, linked);
    expect(() => planCollectorPurge(paths(linked), environment)).toThrow(
      /symbolic link/,
    );
    expect(existsSync(real)).toBe(true);
  });

  it("canonicalizes symlinked ancestors into one state identity", () => {
    const realParent = join(root, "real-parent");
    const linkedParent = join(root, "linked-parent");
    mkdirSync(realParent);
    symlinkSync(realParent, linkedParent);
    const resolved = paths(join(linkedParent, "state"));
    const canonicalParent = realpathSync(realParent);
    expect(resolved.stateDir).toBe(join(canonicalParent, "state"));
    expect(resolved.owner).toBe(
      join(canonicalParent, "state", ".seorak-state.json"),
    );
  });

  it("keeps the external revocation control directory outside the purge target", () => {
    const state = join(root, "state");
    const nestedControl = join(state, "control");
    const nestedEnvironment = { ...environment, controlDir: nestedControl };
    const resolved = resolveCollectorLifecyclePaths(state, nestedEnvironment);
    expect(() => planCollectorPurge(resolved, nestedEnvironment)).toThrow(
      /unsafe collector state path/,
    );
  });

  it("refuses an unowned non-empty custom target", () => {
    const state = join(root, "custom");
    mkdirSync(state);
    writeFileSync(join(state, "important.txt"), "not Seorak");
    expect(() => planCollectorPurge(paths(state), environment)).toThrow(
      /unowned custom/,
    );
    expect(() => claimCollectorState(paths(state), environment)).toThrow(
      /non-empty custom/,
    );
  });

  it("claims an empty custom target and binds the owner to its state key", () => {
    const state = join(root, "custom");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    expect(planCollectorPurge(resolved, environment).stateExists).toBe(true);
    expect(readFileSync(resolved.owner, "utf8")).toContain(resolved.stateKey);
  });

  it("allows the exact default directory as the sole unmarked legacy target", () => {
    const state = join(home, ".seorak");
    mkdirSync(state);
    writeFileSync(join(state, "events.jsonl"), "{}\n");
    expect(planCollectorPurge(paths(state), environment).stateExists).toBe(
      true,
    );
  });
});

describe("transactional collector purge", () => {
  it("revokes capture durably, renames the namespace, and deletes all state", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    writeFileSync(join(state, "events.jsonl"), "private-event\n");

    activateCollectorState(resolved);
    expect(collectorCaptureRevoked(state, environment)).toBe(false);
    beginCollectorPurge(resolved);
    expect(collectorCaptureRevoked(state, environment)).toBe(true);
    advanceCollectorPurge(resolved, "service-stopped");
    advanceCollectorPurge(resolved, "hooks-removed");
    purgeCollectorStateDirectory(resolved, environment);

    expect(existsSync(state)).toBe(false);
    expect(planCollectorPurge(resolved, environment)).toMatchObject({
      stateExists: false,
      phase: "purged",
      tombstone: null,
    });
    const lifecycle = readFileSync(resolved.lifecycle, "utf8");
    expect(lifecycle).not.toContain(state);
    expect(lifecycle).not.toContain("private-event");
  });

  it("leaves an exact journal-bound tombstone and safely resumes after rm failure", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    writeFileSync(join(state, "events.jsonl"), "queued\n");
    beginCollectorPurge(resolved);
    advanceCollectorPurge(resolved, "hooks-removed");

    expect(() =>
      purgeCollectorStateDirectory(resolved, environment, {
        removeDirectory: () => {
          throw new Error("injected rm failure");
        },
      }),
    ).toThrow(/injected rm failure/);

    const interrupted = planCollectorPurge(resolved, environment);
    expect(interrupted.stateExists).toBe(false);
    expect(interrupted.phase).toBe("state-renamed");
    expect(interrupted.tombstone).not.toBeNull();
    expect(existsSync(interrupted.tombstone!)).toBe(true);

    purgeCollectorStateDirectory(resolved, environment);
    expect(existsSync(interrupted.tombstone!)).toBe(false);
    expect(planCollectorPurge(resolved, environment).phase).toBe("purged");
  });

  it("never regresses a journal phase during a resumed purge", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    beginCollectorPurge(resolved);
    advanceCollectorPurge(resolved, "hooks-removed");
    advanceCollectorPurge(resolved, "service-stopped");
    expect(planCollectorPurge(resolved, environment).phase).toBe(
      "hooks-removed",
    );
  });

  it("verifies the journaled tombstone identity again before retry deletion", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    beginCollectorPurge(resolved);
    expect(() =>
      purgeCollectorStateDirectory(resolved, environment, {
        removeDirectory: () => {
          throw new Error("pause after rename");
        },
      }),
    ).toThrow(/pause after rename/);
    const tombstone = planCollectorPurge(resolved, environment).tombstone!;
    const displaced = join(root, "real-tombstone");
    renameSync(tombstone, displaced);
    mkdirSync(tombstone);
    writeFileSync(join(tombstone, "must-survive"), "replacement");

    expect(() => purgeCollectorStateDirectory(resolved, environment)).toThrow(
      /tombstone identity changed/,
    );
    expect(readFileSync(join(tombstone, "must-survive"), "utf8")).toBe(
      "replacement",
    );
  });

  it("never adopts state that appears after an inode-less purge request", () => {
    const state = join(root, "state");
    const resolved = paths(state);
    beginCollectorPurge(resolved);
    mkdirSync(state);
    writeFileSync(join(state, "must-survive"), "late directory");

    expect(() => purgeCollectorStateDirectory(resolved, environment)).toThrow(
      /state identity changed/,
    );
    expect(readFileSync(join(state, "must-survive"), "utf8")).toBe(
      "late directory",
    );
  });

  it("refuses a state-directory identity swap after revocation", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    beginCollectorPurge(resolved);

    const displaced = join(root, "displaced");
    // An unrelated process swaps the validated directory before destructive work.
    // The purge journal's original device/inode must prevent deleting the replacement.
    renameSync(state, displaced);
    mkdirSync(state);
    writeFileSync(join(state, "must-survive"), "replacement");

    expect(() => purgeCollectorStateDirectory(resolved, environment)).toThrow(
      /identity changed/,
    );
    expect(readFileSync(join(state, "must-survive"), "utf8")).toBe(
      "replacement",
    );
  });

  it("blocks init during an incomplete purge and permits explicit reactivation afterward", () => {
    const state = join(root, "state");
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    beginCollectorPurge(resolved);
    expect(() => assertCollectorCanInitialize(resolved)).toThrow(
      /purge is incomplete/,
    );
    advanceCollectorPurge(resolved, "hooks-removed");
    purgeCollectorStateDirectory(resolved, environment);
    expect(() => assertCollectorCanInitialize(resolved)).not.toThrow();

    claimCollectorState(resolved, environment);
    activateCollectorState(resolved);
    expect(collectorCaptureRevoked(state, environment)).toBe(false);
  });

  it("treats a malformed external lifecycle record as revoked", () => {
    const state = join(root, "state");
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    activateCollectorState(resolved);
    writeFileSync(resolved.lifecycle, "{}\n");
    expect(collectorCaptureRevoked(state, environment)).toBe(true);
    expect(() => planCollectorPurge(resolved, environment)).toThrow(
      /lifecycle record is invalid/,
    );
  });

  it("serializes lifecycle commands and reclaims no live owner", () => {
    const resolved = paths(join(root, "state"));
    const release = acquireCollectorLifecycleLock(resolved);
    expect(() => acquireCollectorLifecycleLock(resolved)).toThrow(
      /already running/,
    );
    release();
    expect(existsSync(resolved.lock)).toBe(false);
    expect(readdirSync(resolved.controlDir)).toEqual([]);
    const releaseAgain = acquireCollectorLifecycleLock(resolved);
    releaseAgain();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("adopts and safely reclaims a dead legacy lifecycle owner", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    writeFileSync(
      resolved.lock,
      JSON.stringify({ pid: 2_147_483_647, token: "legacy-dead" }),
    );

    const release = acquireCollectorLifecycleLock(resolved);
    expect(readFileSync(resolved.lock, "utf8")).toContain(
      `"pid":${process.pid}`,
    );
    release();
    expect(existsSync(resolved.lock)).toBe(false);
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("repairs and reclaims a new-format owner with a missing anchor", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    writeFileSync(
      resolved.lock,
      JSON.stringify({
        pid: 2_147_483_647,
        token: "interrupted-reclaim",
        claimVersion: 1,
      }),
    );

    const release = acquireCollectorLifecycleLock(resolved);
    expect(JSON.parse(readFileSync(resolved.lock, "utf8"))).toMatchObject({
      pid: process.pid,
      claimVersion: 1,
    });
    release();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("transfers a dead reclamation anchor and completes recovery", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    const owner = {
      pid: 2_147_483_647,
      token: "interrupted-transfer",
      claimVersion: 1,
    };
    writeFileSync(resolved.lock, JSON.stringify(owner));
    const companion = `${resolved.lock}.${owner.token}.owner`;
    linkSync(resolved.lock, companion);
    const abandonedClaim =
      `${companion}.reclaim.2147483647.abandoned-claim`;
    renameSync(companion, abandonedClaim);

    const release = acquireCollectorLifecycleLock(resolved);
    expect(existsSync(abandonedClaim)).toBe(false);
    expect(JSON.parse(readFileSync(resolved.lock, "utf8"))).toMatchObject({
      pid: process.pid,
      claimVersion: 1,
    });
    release();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("does not transfer a reclamation anchor from a live claimant", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    const owner = {
      pid: 2_147_483_647,
      token: "live-transfer",
      claimVersion: 1,
    };
    writeFileSync(resolved.lock, JSON.stringify(owner));
    const companion = `${resolved.lock}.${owner.token}.owner`;
    linkSync(resolved.lock, companion);
    const liveClaim = `${companion}.reclaim.${process.pid}.live-claim`;
    renameSync(companion, liveClaim);

    expect(() => acquireCollectorLifecycleLock(resolved)).toThrow(
      /changing ownership/,
    );
    expect(existsSync(resolved.lock)).toBe(true);
    expect(existsSync(liveClaim)).toBe(true);
  });

  it("publishes a successor after a claimant unlinked the old canonical", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    const owner = {
      pid: 2_147_483_647,
      token: "post-linearization",
      claimVersion: 1,
    };
    writeFileSync(resolved.lock, JSON.stringify(owner));
    const companion = `${resolved.lock}.${owner.token}.owner`;
    linkSync(resolved.lock, companion);
    const abandonedClaim =
      `${companion}.reclaim.2147483647.abandoned-cleanup`;
    renameSync(companion, abandonedClaim);
    rmSync(resolved.lock);

    const release = acquireCollectorLifecycleLock(resolved);
    expect(existsSync(abandonedClaim)).toBe(false);
    expect(JSON.parse(readFileSync(resolved.lock, "utf8"))).toMatchObject({
      pid: process.pid,
      claimVersion: 1,
    });
    release();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("scavenges dead publication artifacts before canonical publication", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    const orphan = `${resolved.lock}.orphan-dead.owner`;
    const candidate =
      `${orphan}.2147483647.orphan-dead.candidate`;
    const temporary =
      `${candidate}.00000000-0000-4000-8000-000000000000.tmp`;
    const abandoned = {
      pid: 2_147_483_647,
      token: "orphan-dead",
      claimVersion: 1,
    };
    writeFileSync(orphan, JSON.stringify(abandoned));
    writeFileSync(
      candidate,
      JSON.stringify(abandoned),
    );
    writeFileSync(temporary, "");

    const release = acquireCollectorLifecycleLock(resolved);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(candidate)).toBe(false);
    expect(existsSync(temporary)).toBe(false);
    expect(JSON.parse(readFileSync(resolved.lock, "utf8"))).toMatchObject({
      pid: process.pid,
      claimVersion: 1,
    });
    release();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("preserves unrelated near-prefix files during orphan cleanup", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    const unrelated = `${resolved.daemonOwner}.notes.owner.backup`;
    writeFileSync(
      unrelated,
      JSON.stringify({ pid: 2_147_483_647, token: "notes" }),
    );

    const release = acquireDaemonLease(resolved);
    expect(existsSync(unrelated)).toBe(true);
    release();
    expect(existsSync(unrelated)).toBe(true);
  });

  it("accepts the maximum portable owner-token path budget", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    writeFileSync(
      resolved.lock,
      JSON.stringify({
        pid: 2_147_483_647,
        token: "x".repeat(58),
      }),
    );

    const release = acquireCollectorLifecycleLock(resolved);
    release();
    expect(readdirSync(resolved.controlDir)).toEqual([]);
  });

  it("rejects owner tokens that exceed the portable path budget", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    writeFileSync(
      resolved.lock,
      JSON.stringify({
        pid: 2_147_483_647,
        token: "x".repeat(59),
        claimVersion: 1,
      }),
    );

    expect(() => acquireCollectorLifecycleLock(resolved)).toThrow(
      /incomplete or corrupt/,
    );
    expect(existsSync(resolved.lock)).toBe(true);
  });

  it("conservatively refuses an incomplete lifecycle owner publication", () => {
    const resolved = paths(join(root, "state"));
    mkdirSync(resolved.controlDir, { recursive: true });
    writeFileSync(resolved.lock, "");
    expect(() => acquireCollectorLifecycleLock(resolved)).toThrow(
      /incomplete or corrupt/,
    );
    expect(existsSync(resolved.lock)).toBe(true);
  });

  it("revokes new hooks and drains a pre-revocation lease before deletion", async () => {
    const state = join(root, "state");
    const resolved = paths(state);
    claimCollectorState(resolved, environment);
    activateCollectorState(resolved);
    const releaseHook = await acquireHookCaptureLease(resolved);
    expect(releaseHook).not.toBeNull();
    expect(hookCaptureLeaseStatus(resolved)).toBe("live");

    beginCollectorPurge(resolved);
    await expect(acquireHookCaptureLease(resolved)).resolves.toBeNull();
    writeFileSync(join(state, "late-hook-write"), "must be purged");
    expect(() => purgeCollectorStateDirectory(resolved, environment)).toThrow(
      /hook capture is still active/,
    );

    releaseHook!();
    expect(hookCaptureLeaseStatus(resolved)).toBe("clear");
    purgeCollectorStateDirectory(resolved, environment);
    expect(existsSync(state)).toBe(false);
  });
});

describe("daemon ownership lease", () => {
  it("proves a live daemon owner and releases only its own lease", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    const release = acquireDaemonLease(resolved);
    expect(daemonLeaseStatus(resolved)).toBe("live");
    expect(() => acquireDaemonLease(resolved)).toThrow(/already running/);
    release();
    expect(daemonLeaseStatus(resolved)).toBe("absent");
    expect(
      readdirSync(state).filter((name) => name.includes(".daemon-owner")),
    ).toEqual([]);
  });

  it("distinguishes stale ownership from a live process", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    writeFileSync(
      resolved.daemonOwner,
      JSON.stringify({ pid: 2_147_483_647, token: "stale" }),
    );
    expect(daemonLeaseStatus(resolved)).toBe("stale");
    const release = acquireDaemonLease(resolved);
    expect(daemonLeaseStatus(resolved)).toBe("live");
    release();
  });

  it("never reclaims an incomplete daemon owner publication", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const resolved = paths(state);
    writeFileSync(resolved.daemonOwner, "");
    expect(daemonLeaseStatus(resolved)).toBe("invalid");
    expect(() => acquireDaemonLease(resolved)).toThrow(/incomplete or corrupt/);
    expect(existsSync(resolved.daemonOwner)).toBe(true);
  });
});
