/**
 * cli-help.test.ts — asking for help must never install, load, stop, or remove
 * anything.
 *
 * `--help` is often the first thing a new reader types. It used to be honored
 * ONLY for a bare `seorak`, so `seorak init --help` fell past the help branch
 * into the switch and ran the real installer: the Claude Code hook bindings in
 * ~/.claude/settings.json, a LaunchAgent plist, and a loaded background
 * service, on the machine of someone who was reading rather than installing.
 *
 * The assertions are therefore on the SIDE EFFECTS and not only on the printed
 * text: every module a subcommand reaches for its effects is replaced here, so
 * a regression reads as "installHooks was called" instead of as a modified
 * developer machine. HOME is redirected for the same reason — the plist and the
 * settings file are the two writes that resolve from it, and a test for this
 * bug must be safe to run against the broken code.
 *
 * `-h` is covered next to `--help` because parseArgs only understands `--`
 * forms, which made `-h` a positional the original guard could not see at all.
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

// The session is the bare command's handler and blocks forever on a TTY. Mocked
// so a regression in the bare `--help` case fails the run instead of hanging it.
vi.mock("../src/terminal/shell.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/terminal/shell.ts")>()),
  runInteractive: effects.runInteractive,
  runOnce: effects.runOnce,
}));

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli.ts";

/** `homedir()` reads $HOME on this platform, so this relocates both writes that
 *  do not go through a mocked module: the LaunchAgent plist and the Claude Code
 *  settings file. Nothing here should create either one. */
const home = mkdtempSync(join(tmpdir(), "seorak-cli-help-home-"));
const realHome = process.env.HOME;
const plistPath = join(
  home,
  "Library",
  "LaunchAgents",
  "app.seorak.collector.plist",
);

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOME = home;
  process.env.SEORAK_SETTINGS = join(home, ".claude", "settings.json");
  // Cleared per test, so one case that DOES install cannot make every later
  // case fail on its leftovers instead of on its own behavior.
  rmSync(join(home, "Library"), { recursive: true, force: true });
  rmSync(join(home, ".claude"), { recursive: true, force: true });
});

/** Every replaced effect at once, named in the failure, so a subcommand added
 *  later cannot quietly fall off a hand-written list. */
function assertNothingRan(): void {
  const called = Object.entries(effects)
    .filter(([, effect]) => effect.mock.calls.length > 0)
    .map(([name]) => name);
  expect(called).toEqual([]);
  expect(existsSync(plistPath)).toBe(false);
  expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
}

describe("--help never runs a subcommand", () => {
  it.each([
    [["init", "--help"]],
    [["init", "-h"]],
    [["init", "--worker-url", "https://seorak.invalid", "--help"]],
    [["init", "--no-service", "-h"]],
    [["start", "--help"]],
    [["start", "-h"]],
    [["stop", "-h"]],
    [["uninstall", "--help"]],
    [["uninstall", "--purge", "-h"]],
    [["login", "--help"]],
    [["home", "-h"]],
    [["local", "export", "--help"]],
  ])("prints help and exits 0 for %j without touching the machine", async (argv) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(run(argv)).resolves.toBe(0);

    expect(log.mock.calls.flat().join("\n")).toContain("seorak init [--no-service]");
    expect(error).not.toHaveBeenCalled();
    assertNothingRan();
  });

  it("still answers the help forms that never had a subcommand", async () => {
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await expect(run(argv)).resolves.toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain(
        "seorak status [--worker-url URL]",
      );
      assertNothingRan();
      vi.clearAllMocks();
    }
  });
});

describe("a subcommand without the help flag still does its work", () => {
  it("mints the credential for `seorak remote credential`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "seorak-cli-help-state-"));
    const previous = process.env.SEORAK_DIR;
    process.env.SEORAK_DIR = dir;
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(run(["remote", "credential"])).resolves.toBe(0);
      expect(existsSync(join(dir, "self-hosted-credential"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.SEORAK_DIR;
      else process.env.SEORAK_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still stops the service for a plain `seorak stop`", async () => {
    if (process.platform !== "darwin") return; // no launchd: the command refuses
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["stop"])).resolves.toBe(0);

    expect(effects.stopLaunchdService).toHaveBeenCalledTimes(1);
  });

  it("still rejects an unknown flag rather than reading it as help", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(run(["uninstall", "--unknown"])).resolves.toBe(1);

    expect(error.mock.calls.flat().join("\n")).toContain(
      "unknown uninstall flag: --unknown",
    );
    assertNothingRan();
  });
});
