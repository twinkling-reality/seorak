import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectorRuntimeLayout,
  collectorRuntimeOrigin,
  collectorRuntimeReady,
  ensureCollectorRuntime,
} from "../src/runtime-install.ts";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "seorak-runtime-install-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable collector runtime", () => {
  it("uses a versioned directory inside Seorak state", () => {
    const layout = collectorRuntimeLayout("/tmp/seorak-state", "1.2.3");
    expect(layout.prefix).toBe("/tmp/seorak-state/runtime/1.2.3");
    expect(layout.binDir).toBe(
      "/tmp/seorak-state/runtime/1.2.3/node_modules/seorak/dist",
    );
  });

  it("requires the collector entry points and dashboard dependency together", () => {
    const root = temporaryRoot();
    const layout = collectorRuntimeLayout(root, "1.2.3");
    mkdirSync(layout.binDir, { recursive: true });
    writeFileSync(
      join(layout.packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );
    for (const file of [
      "seorak.mjs",
      "daemon.mjs",
      "hook-session-start.mjs",
      "hook-tool-use.mjs",
      "hook-session-end.mjs",
      "hook-notification.mjs",
      "hook-user-prompt.mjs",
    ]) {
      writeFileSync(join(layout.binDir, file), "");
    }

    expect(collectorRuntimeReady(layout)).toBe(false);
    const dashboard = join(layout.prefix, "node_modules", "@seorak", "dashboard");
    mkdirSync(dashboard, { recursive: true });
    writeFileSync(join(dashboard, "package.json"), '{}\n');
    expect(collectorRuntimeReady(layout)).toBe(true);
  });

  it("keeps source-checkout setup local and makes no runtime copy", () => {
    const state = temporaryRoot();
    const result = ensureCollectorRuntime(state);
    expect(result.origin).toBe("source");
    expect(result.installed).toBe(false);
    expect(result.binDir).toMatch(/packages\/collector\/bin$/);
    expect(existsSync(join(state, "runtime"))).toBe(false);
  });

  // The origin decides whether a copy is staged. Deciding it from the subcommand
  // instead is what let `init` bind hooks into npm's disposable cache and let
  // `setup` stage a second copy for someone who already had a durable install.
  it("classifies by location, not by which command was typed", () => {
    const checkout = "/Users/dev/seorak/packages/collector";
    expect(collectorRuntimeOrigin(checkout, join(checkout, "bin"))).toBe("source");

    const global = "/usr/local/lib/node_modules/seorak";
    expect(collectorRuntimeOrigin(global, join(global, "dist"))).toBe("durable");

    const npx = join(
      "/Users/dev/.npm/_cacache/../_npx/9f2/node_modules/seorak",
    );
    expect(collectorRuntimeOrigin(npx, join(npx, "dist"))).toBe("ephemeral");

    const relocated = "/var/cache/npm/_npx/aa1/node_modules/seorak";
    expect(
      collectorRuntimeOrigin(relocated, join(relocated, "dist"), {
        npm_config_cache: "/var/cache/npm",
      }),
    ).toBe("ephemeral");
  });

  // A global install is already durable. Staging a second copy moved the
  // LaunchAgent onto it while the hooks stayed on the global one, so uninstalling
  // the global silently killed capture while the daemon kept running.
  it("binds a durable install in place instead of staging a second copy", () => {
    const root = temporaryRoot();
    const packageRoot = join(root, "lib", "node_modules", "seorak");
    const binDir = join(packageRoot, "dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );

    const state = join(root, "state");
    const result = ensureCollectorRuntime(state, {
      packageRoot,
      binDir,
      runInstall: () => {
        throw new Error("a durable install must not reach the registry");
      },
    });

    expect(result.origin).toBe("durable");
    expect(result.installed).toBe(false);
    expect(result.binDir).toBe(binDir);
    expect(existsSync(join(state, "runtime"))).toBe(false);
  });

  it("installs the executing package version into durable state", () => {
    const root = temporaryRoot();
    const packageRoot = join(root, "_npx", "9f2", "node_modules", "seorak");
    const binDir = join(packageRoot, "dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );

    let command: { executable: string; args: readonly string[] } | null = null;
    const state = join(root, "state");
    const result = ensureCollectorRuntime(state, {
      packageRoot,
      binDir,
      runInstall(executable, args) {
        command = { executable, args };
        const layout = collectorRuntimeLayout(state, "1.2.3");
        mkdirSync(layout.binDir, { recursive: true });
        writeFileSync(
          join(layout.packageRoot, "package.json"),
          '{"name":"seorak","version":"1.2.3"}\n',
        );
        for (const file of [
          "seorak.mjs",
          "daemon.mjs",
          "hook-session-start.mjs",
          "hook-tool-use.mjs",
          "hook-session-end.mjs",
          "hook-notification.mjs",
          "hook-user-prompt.mjs",
        ]) {
          writeFileSync(join(layout.binDir, file), "");
        }
        const dashboard = join(layout.prefix, "node_modules", "@seorak", "dashboard");
        mkdirSync(dashboard, { recursive: true });
        writeFileSync(join(dashboard, "package.json"), "{}\n");
        return { status: 0 };
      },
    });

    expect(result.installed).toBe(true);
    expect(result.origin).toBe("ephemeral");
    expect(result.version).toBe("1.2.3");
    expect(command?.args).toContain("seorak@1.2.3");
    expect(command?.args).toContain("--ignore-scripts");
    expect(command?.args).toContain("--no-save");
  });

  // Collapsing every cause into "check that npm can reach the registry" told an
  // offline user, a user behind a proxy, a user without write permission, and a
  // user whose npm is missing the same wrong thing. npm's own words are the fix.
  it("surfaces npm's own failure output instead of guessing at the cause", () => {
    const root = temporaryRoot();
    const packageRoot = join(root, "_npx", "9f2", "node_modules", "seorak");
    const binDir = join(packageRoot, "dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );

    expect(() =>
      ensureCollectorRuntime(join(root, "state"), {
        packageRoot,
        binDir,
        runInstall: () => ({
          status: 1,
          stderr: "npm error code E404\nnpm error 404 Not Found - GET .../@seorak%2fcollector",
        }),
      }),
    ).toThrow(/E404[\s\S]*404 Not Found/);
  });

  it("says so plainly when npm itself cannot be started", () => {
    const root = temporaryRoot();
    const packageRoot = join(root, "_npx", "9f2", "node_modules", "seorak");
    const binDir = join(packageRoot, "dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );

    expect(() =>
      ensureCollectorRuntime(join(root, "state"), {
        packageRoot,
        binDir,
        runInstall: () => ({ status: null }),
      }),
    ).toThrow(/npm could not be started/);
  });

  it("never reports a failure as success — existing capture is left alone", () => {
    const root = temporaryRoot();
    const packageRoot = join(root, "_npx", "9f2", "node_modules", "seorak");
    const binDir = join(packageRoot, "dist");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"seorak","version":"1.2.3"}\n',
    );

    const state = join(root, "state");
    // npm claims success but stages nothing: the readiness re-check has to catch
    // it, or setup would bind hooks to a directory with no hook scripts in it.
    expect(() =>
      ensureCollectorRuntime(state, {
        packageRoot,
        binDir,
        runInstall: () => ({ status: 0 }),
      }),
    ).toThrow(/could not make Seorak available/);
  });
});
