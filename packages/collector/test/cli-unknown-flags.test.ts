/**
 * cli-unknown-flags.test.ts — unknown flags must not reach side effects.
 *
 * `seorak init --dry-run` used to run a real install (uninstall's help teaches
 * `--dry-run`, so the typo/habit is common). `seorak init --worker-uri URL`
 * used to report a successful account-free install while the caller believed
 * they had configured a worker. `start`, `stop`, and the bare session had the
 * same hole: unknown flags were ignored and the command proceeded.
 *
 * Assertions are on SIDE EFFECTS (mocked install/launchctl/session), not on
 * the printed error text. A regression that still mutates the machine must
 * fail even if the message looks right.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({
  installHooks: vi.fn(() => ({
    added: [],
    skipped: [],
    removed: [],
    repaired: [],
    settingsPath: "/dev/null",
    backedUp: false,
  })),
  removeHooks: vi.fn(() => ({
    added: [],
    skipped: [],
    removed: [],
    repaired: [],
    settingsPath: "/dev/null",
    backedUp: false,
  })),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
  stopLaunchdService: vi.fn(() => ({ stopped: true, attempted: true })),
  runInteractive: vi.fn(async () => 0),
  runOnce: vi.fn(async () => 0),
}));

vi.mock("../src/install.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/install.ts")>()),
  installHooks: effects.installHooks,
  removeHooks: effects.removeHooks,
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: effects.spawnSync,
}));

vi.mock("../src/launchd.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/launchd.ts")>()),
  stopLaunchdService: effects.stopLaunchdService,
}));

vi.mock("../src/terminal/shell.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/terminal/shell.ts")>()),
  runInteractive: effects.runInteractive,
  runOnce: effects.runOnce,
}));

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { run } from "../src/cli.ts";

const home = mkdtempSync(join(tmpdir(), "seorak-cli-unknown-flags-home-"));
const realHome = process.env.HOME;
const plistPath = join(
  home,
  "Library",
  "LaunchAgents",
  "app.seorak.collector.plist",
);

/** A plist that would let `seorak start` reach launchctl. Without it, a missing
 *  agent returns 1 for the wrong reason and an unknown-flag regression looks green. */
function plantPlist(): void {
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist/>\n");
}

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOME = home;
  process.env.SEORAK_SETTINGS = join(home, ".claude", "settings.json");
  delete process.env.SEORAK_WORKER_URL;
  delete process.env.SEORAK_INGEST_KEY;
  delete process.env.SEORAK_READ_KEY;
  rmSync(join(home, "Library"), { recursive: true, force: true });
  rmSync(join(home, ".claude"), { recursive: true, force: true });
});

function assertNoMutatingEffects(): void {
  expect(effects.installHooks).not.toHaveBeenCalled();
  expect(effects.removeHooks).not.toHaveBeenCalled();
  expect(effects.spawnSync).not.toHaveBeenCalled();
  expect(effects.stopLaunchdService).not.toHaveBeenCalled();
  expect(effects.runInteractive).not.toHaveBeenCalled();
  expect(effects.runOnce).not.toHaveBeenCalled();
  expect(existsSync(plistPath)).toBe(false);
  expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
}

describe("unknown flags never reach side effects", () => {
  it.each([
    ["init", ["init", "--dry-run"]],
    ["init", ["init", "--worker-uri", "https://seorak.invalid"]],
    ["init", ["init", "--no-service", "--unknown"]],
    ["stop", ["stop", "--dry-run"]],
    ["stop", ["stop", "--unknown"]],
    ["session", ["--dry-run"]],
    ["session", ["--worker-uri", "https://seorak.invalid"]],
    ["session", ["--once", "--unknown"]],
  ])("%s rejects %j before any side effect", async (_label, argv) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(argv)).resolves.toBe(1);
    assertNoMutatingEffects();
  });

  it("rejects start --dry-run before launchctl when an agent is installed", async () => {
    if (process.platform !== "darwin") return;
    plantPlist();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["start", "--dry-run"])).resolves.toBe(1);
    expect(effects.spawnSync).not.toHaveBeenCalled();
    expect(effects.installHooks).not.toHaveBeenCalled();
  });

  it("rejects start --foreground --unknown before loading the daemon", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["start", "--foreground", "--unknown"])).resolves.toBe(1);
    assertNoMutatingEffects();
  });

  it("rejects bare --worker-url on init before install (needs a URL)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["init", "--worker-url"])).resolves.toBe(1);
    assertNoMutatingEffects();
  });

  it("rejects --no-service with a value before install", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["init", "--no-service=yes"])).resolves.toBe(1);
    assertNoMutatingEffects();
  });

  it("rejects --foreground with a value before start", async () => {
    if (process.platform !== "darwin") return;
    plantPlist();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["start", "--foreground=yes"])).resolves.toBe(1);
    expect(effects.spawnSync).not.toHaveBeenCalled();
  });
});

describe("known flags still reach their handlers", () => {
  it("runs init with --no-service (installHooks fires; launchctl does not)", async () => {
    const state = mkdtempSync(join(tmpdir(), "seorak-cli-unknown-flags-state-"));
    const previous = process.env.SEORAK_DIR;
    process.env.SEORAK_DIR = state;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Exit code depends on hook verification against a mocked installer; the
      // contract here is that a known flag still reaches installHooks and never
      // launchctl under --no-service.
      await run(["init", "--no-service"]);
      expect(effects.installHooks).toHaveBeenCalledTimes(1);
      expect(effects.spawnSync).not.toHaveBeenCalled();
      expect(effects.stopLaunchdService).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SEORAK_DIR;
      else process.env.SEORAK_DIR = previous;
      rmSync(state, { recursive: true, force: true });
    }
  });

  it("opens the interactive session with no flags", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(run([])).resolves.toBe(0);
    expect(effects.runInteractive).toHaveBeenCalledTimes(1);
    expect(effects.runOnce).not.toHaveBeenCalled();
    expect(effects.installHooks).not.toHaveBeenCalled();
  });

  it("opens the one-shot session for --once", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(run(["--once"])).resolves.toBe(0);
    expect(effects.runOnce).toHaveBeenCalledTimes(1);
    expect(effects.runInteractive).not.toHaveBeenCalled();
    expect(effects.installHooks).not.toHaveBeenCalled();
  });

  it("still stops the service for a plain `seorak stop`", async () => {
    if (process.platform !== "darwin") return;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["stop"])).resolves.toBe(0);
    expect(effects.stopLaunchdService).toHaveBeenCalledTimes(1);
  });

  it("still loads launchctl for a plain `seorak start` when installed", async () => {
    if (process.platform !== "darwin") return;
    plantPlist();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await run(["start"]);
    expect(effects.spawnSync).toHaveBeenCalled();
    expect(effects.stopLaunchdService).not.toHaveBeenCalled();
  });
});
