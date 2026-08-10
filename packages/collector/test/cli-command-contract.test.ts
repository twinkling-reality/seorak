import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/cli.ts";
import {
  claimCollectorState,
  resolveCollectorLifecyclePaths,
} from "../src/collector-lifecycle.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI command contract", () => {
  it("rejects the retired stats subcommand instead of preserving an alias", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["stats"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith("unknown command: stats\n");
    expect(log.mock.calls.flat().join("\n")).toContain("seorak [--once]");
  });

  it("rejects the retired doctor alias instead of preserving a compatibility path", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["doctor"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith("unknown command: doctor\n");
    expect(log.mock.calls.flat().join("\n")).toContain("seorak status");
  });

  it("advertises only commands the current terminal session implements", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run(["help"])).resolves.toBe(0);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("/range <7|30|90>");
    expect(output).toContain("/view [paragraph|list|projects]");
    expect(output).not.toMatch(/\/(?:add|remove|layout)\b/);
    expect(output).toContain("uninstall --purge [--dry-run]");
  });

  it.each([
    ["--unknown", "unknown uninstall flag"],
    ["--purge=false", "--purge does not take a value"],
    ["--dry-run=yes", "--dry-run does not take a value"],
  ])("rejects unsafe uninstall flag form %s before side effects", async (flag, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(run(["uninstall", flag])).resolves.toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(message);
  });

  it("rejects extra uninstall positionals before destructive flags are evaluated", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      run(["uninstall", "unexpected", "--purge"]),
    ).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(
      "✘ unexpected uninstall argument: unexpected",
    );
  });

  it("validates and previews purge without mutating service, hooks, lifecycle, or state", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "seorak-uninstall-dry-"));
    const state = join(sandbox, "state");
    const control = join(sandbox, "control");
    const settings = join(sandbox, "settings.json");
    const lifecycle = resolveCollectorLifecyclePaths(state, {
      controlDir: control,
    });
    claimCollectorState(lifecycle, { controlDir: control });
    writeFileSync(join(state, "events.jsonl"), "retained\n");
    writeFileSync(settings, "{}\n");

    const previousDir = process.env.SEORAK_DIR;
    const previousControl = process.env.SEORAK_CONTROL_DIR;
    const previousSettings = process.env.SEORAK_SETTINGS;
    process.env.SEORAK_DIR = state;
    process.env.SEORAK_CONTROL_DIR = control;
    process.env.SEORAK_SETTINGS = settings;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        run(["uninstall", "--purge", "--dry-run"]),
      ).resolves.toBe(0);
      expect(readFileSync(join(state, "events.jsonl"), "utf8")).toBe("retained\n");
      expect(existsSync(lifecycle.lifecycle)).toBe(false);
      expect(readFileSync(settings, "utf8")).toBe("{}\n");
      expect(log.mock.calls.flat().join("\n")).toContain(
        `would permanently purge collector data at ${lifecycle.stateDir}`,
      );
    } finally {
      if (previousDir === undefined) delete process.env.SEORAK_DIR;
      else process.env.SEORAK_DIR = previousDir;
      if (previousControl === undefined) delete process.env.SEORAK_CONTROL_DIR;
      else process.env.SEORAK_CONTROL_DIR = previousControl;
      if (previousSettings === undefined) delete process.env.SEORAK_SETTINGS;
      else process.env.SEORAK_SETTINGS = previousSettings;
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  describe("seorak remote credential", () => {
    function sandbox(): string {
      const path = mkdtempSync(join(tmpdir(), "seorak-remote-credential-"));
      return path;
    }

    async function withState<T>(run: (dir: string) => Promise<T>): Promise<T> {
      const dir = sandbox();
      const previous = process.env.SEORAK_DIR;
      process.env.SEORAK_DIR = dir;
      try {
        return await run(dir);
      } finally {
        if (previous === undefined) delete process.env.SEORAK_DIR;
        else process.env.SEORAK_DIR = previous;
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("mints a 0600 credential and prints it exactly once", async () => {
      await withState(async (dir) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await expect(run(["remote", "credential"])).resolves.toBe(0);

        const path = join(dir, "self-hosted-credential");
        expect(existsSync(path)).toBe(true);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        const credential = readFileSync(path, "utf8").trim();
        expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(log.mock.calls.flat().join("\n")).toContain(credential);

        // Never printed again. Reading a live secret back would put it in a
        // scrollback for a caller who may only have been checking whether one
        // exists.
        log.mockClear();
        await expect(run(["remote", "credential"])).resolves.toBe(0);
        const second = log.mock.calls.flat().join("\n");
        expect(second).not.toContain(credential);
        expect(second).toContain("already exists");
        expect(readFileSync(path, "utf8").trim()).toBe(credential);
      });
    });

    it("rotates on request, which is the mitigation the design claims", async () => {
      await withState(async (dir) => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await expect(run(["remote", "credential"])).resolves.toBe(0);
        const path = join(dir, "self-hosted-credential");
        const first = readFileSync(path, "utf8").trim();

        await expect(run(["remote", "credential", "--rotate"])).resolves.toBe(0);
        const second = readFileSync(path, "utf8").trim();
        expect(second).not.toBe(first);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(log.mock.calls.flat().join("\n")).toContain(second);
      });
    });

    it.each([
      [["remote"]],
      [["remote", "rotate"]],
      [["remote", "credential", "extra"]],
      [["remote", "credential", "--unknown"]],
      [["remote", "credential", "--rotate=yes"]],
    ])("refuses the malformed invocation %j before minting anything", async (argv) => {
      await withState(async (dir) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(run(argv)).resolves.toBe(1);
        expect(error.mock.calls.flat().join("\n")).toContain(
          "seorak remote credential",
        );
        expect(existsSync(join(dir, "self-hosted-credential"))).toBe(false);
      });
    });
  });

  it("keeps code and authoritative surface docs free of the retired path", () => {
    const cli = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    const shell = readFileSync(
      new URL("../src/terminal/shell.ts", import.meta.url),
      "utf8",
    );
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const surfaces = readFileSync(
      new URL("../../../docs/specs/surfaces.md", import.meta.url),
      "utf8",
    );

    expect(cli).not.toMatch(/\bcmdOnce\b/);
    expect(cli).not.toMatch(/case\s+["']stats["']/);
    expect(cli).not.toMatch(/case\s+["']doctor["']/);
    expect(readme).not.toContain("seorak doctor");
    for (const canonicalModule of ["status", "worker-url", "paths", "dashboard"]) {
      expect(cli).not.toMatch(
        new RegExp(
          `export\\s*\\{[^}]*\\}\\s*from\\s*["']\\./${canonicalModule}\\.ts["']`,
          "s",
        ),
      );
    }
    expect(cli).not.toMatch(/export\s*\{\s*dashboardDeepLink\s*\}/);
    for (const source of [cli, shell, readme, surfaces]) {
      expect(source).not.toContain("seorak stats");
    }
    expect(readme).toContain("seorak --once");
    expect(surfaces).toContain("`seorak --once`");
  });
});
