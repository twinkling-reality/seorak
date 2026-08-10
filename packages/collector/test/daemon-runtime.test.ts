import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateCollectorState,
  beginCollectorPurge,
  claimCollectorState,
  resolveCollectorLifecyclePaths,
} from "../src/collector-lifecycle.ts";

const children = new Set<ChildProcess>();
const directories: string[] = [];

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitFor(
  predicate: () => boolean,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`daemon exited before readiness\n${output()}`);
    }
    await delay(20);
  }
  throw new Error(`daemon readiness timed out\n${output()}`);
}

function positiveNumberFile(path: string): boolean {
  try {
    return Number(readFileSync(path, "utf8")) > 0;
  } catch {
    return false;
  }
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("daemon did not exit after SIGTERM"));
    }, 10_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("foreground daemon process", () => {
  it("refuses to recreate state after a completed or pending purge", async () => {
    const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-purged-"));
    const control = mkdtempSync(join(tmpdir(), "seorak-daemon-control-"));
    directories.push(directory, control);
    const lifecycle = resolveCollectorLifecyclePaths(directory, {
      controlDir: control,
    });
    claimCollectorState(lifecycle, { controlDir: control });
    activateCollectorState(lifecycle);
    beginCollectorPurge(lifecycle);

    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          SEORAK_DIR: directory,
          SEORAK_CONTROL_DIR: control,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    children.add(child);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (value: string) => {
      stderr += value;
    });
    const exited = await waitForExit(child);
    expect(exited).toEqual({ code: 1, signal: null });
    expect(stderr).toContain("collector capture is disabled after purge");
    expect(existsSync(join(directory, "heartbeat"))).toBe(false);
    expect(existsSync(lifecycle.daemonOwner)).toBe(false);
  });

  it("boots against a worker, owns its state files, and drains before SIGTERM exit", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ capture: {} }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("test worker did not bind a TCP port");
    }

    const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-runtime-"));
    directories.push(directory);
    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          SEORAK_DIR: directory,
          SEORAK_WORKER_URL: `http://127.0.0.1:${address.port}`,
          SEORAK_CODEX: "0",
          // These cases are about capture and shipping. The loopback plane binds
          // a real port, so leaving it on would couple parallel daemon spawns
          // to each other through it; local-plane.test.ts covers it directly.
          SEORAK_LOCAL_PLANE: "0",
          SEORAK_MOMENTUM: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.add(child);
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (value: string) => {
      stdout += value;
    });
    child.stderr!.on("data", (value: string) => {
      stderr += value;
    });

    try {
      await waitFor(
        () =>
          positiveNumberFile(join(directory, "heartbeat")) &&
          existsSync(join(directory, "events.jsonl")) &&
          requests.includes("/settings"),
        child,
        () => stdout + stderr,
      );
      expect(
        Number(readFileSync(join(directory, "heartbeat"), "utf8")),
      ).toBeGreaterThan(0);
      expect(stdout).toContain("[seorak/collector] watching");

      const exited = waitForExit(child);
      child.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("aborts a hung startup settings request and exits cleanly on SIGTERM", async () => {
    const server = createServer(() => {
      // Deliberately never respond. Shutdown must abort this startup request.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("test worker did not bind a TCP port");
    }

    const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-stop-"));
    directories.push(directory);
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          SEORAK_DIR: directory,
          SEORAK_WORKER_URL: `http://127.0.0.1:${address.port}`,
          SEORAK_CODEX: "0",
          // These cases are about capture and shipping. The loopback plane binds
          // a real port, so leaving it on would couple parallel daemon spawns
          // to each other through it; local-plane.test.ts covers it directly.
          SEORAK_LOCAL_PLANE: "0",
          SEORAK_MOMENTUM: "0",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    children.add(child);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (value: string) => {
      stderr += value;
    });

    try {
      await waitFor(
        () => existsSync(join(directory, "heartbeat")),
        child,
        () => stderr,
      );
      const exited = waitForExit(child);
      child.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("persists a proven schema block without reading or posting the queue", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          request.url === "/health"
            ? {
                ok: true,
                eventIngest: {
                  currentSchemaVersion: 2,
                  acceptedSchemaVersions: [2],
                },
              }
            : { capture: {} },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("test worker did not bind a TCP port");
    }

    const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-schema-"));
    directories.push(directory);
    const eventLine = `${JSON.stringify({
      kind: "session.prompt",
      eventId: "event-1",
      sessionId: "session-1",
      at: "2026-07-29T12:00:00.000Z",
    })}\n`;
    writeFileSync(join(directory, "events.jsonl"), eventLine, "utf8");
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          SEORAK_DIR: directory,
          SEORAK_WORKER_URL: `http://127.0.0.1:${address.port}`,
          SEORAK_CODEX: "0",
          // These cases are about capture and shipping. The loopback plane binds
          // a real port, so leaving it on would couple parallel daemon spawns
          // to each other through it; local-plane.test.ts covers it directly.
          SEORAK_LOCAL_PLANE: "0",
          SEORAK_MOMENTUM: "0",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    children.add(child);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (value: string) => {
      stderr += value;
    });

    try {
      const statusPath = join(directory, "shipping-status.json");
      await waitFor(
        () => existsSync(statusPath),
        child,
        () => stderr,
      );
      expect(JSON.parse(readFileSync(statusPath, "utf8"))).toMatchObject({
        schemaVersion: 2,
        state: "blocked",
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
          workerAcceptedSchemaVersions: [2],
        },
      });
      expect(
        requests.filter(
          (request) =>
            request.method === "POST" && request.url === "/events",
        ),
      ).toEqual([]);
      expect(readFileSync(join(directory, "events.jsonl"), "utf8")).toBe(
        eventLine,
      );
      expect(existsSync(join(directory, "events.offset"))).toBe(false);

      const exited = waitForExit(child);
      child.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exits cleanly when SIGTERM lands DURING startup", async () => {
    /**
     * The race this pins: shutdown used to clear a fixed list of variables, which
     * is only correct once startup has finished assigning them. A signal arriving
     * mid-boot found `undefined` for the file watcher and the interval timers,
     * which were then created moments later with nobody left to clear them — so
     * the process kept a live `fs.watch` handle and two intervals and never
     * exited. launchd and `seorak stop` both land in exactly that window.
     *
     * Measured before the fix: roughly one hang in three. This kills the daemon
     * as early as the spawn allows, which is the widest the window gets.
     */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-early-"));
      directories.push(directory);
      const env = { ...process.env };
      delete env.SEORAK_WORKER_URL;
      delete env.SEORAK_INGEST_KEY;
      delete env.SEORAK_READ_KEY;
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings=ExperimentalWarning",
          fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
        ],
        {
          cwd: directory,
          env: {
            ...env,
            SEORAK_DIR: directory,
            SEORAK_CODEX: "0",
            SEORAK_MOMENTUM: "0",
            SEORAK_LOCAL_PLANE: "0",
          },
          stdio: ["ignore", "ignore", "ignore"],
        },
      );
      children.add(child);
      // Staggered so the signal lands at a different point in the boot sequence
      // each time rather than always the same one.
      await delay(attempt * 120);
      const exited = waitForExit(child);
      child.kill("SIGTERM");
      // The property under test is THAT IT EXITS. Two clean shapes qualify: a
      // graceful `code: 0` once the handler is installed, and a bare
      // `signal: SIGTERM` before it is, which is the default disposition and is
      // equally correct. What must never happen is the third outcome — neither,
      // until `waitForExit`'s deadline fires.
      const result = await exited;
      expect(
        result.code === 0 || result.signal === "SIGTERM",
        `daemon neither exited 0 nor died on the signal: ${JSON.stringify(result)}`,
      ).toBe(true);
    }
  });

  it("serves the local plane and ships NOTHING when no worker is configured", async () => {
    // The account-free install. Capture and the dashboard read path must come
    // up with no worker, no key, and no network — and, just as importantly, the
    // daemon must not spend the machine's day posting to a localhost default
    // nobody asked for.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const probed = probe.address();
    if (!probed || typeof probed === "string") {
      probe.close();
      throw new Error("could not reserve a local plane port");
    }
    const planePort = probed.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const directory = mkdtempSync(join(tmpdir(), "seorak-daemon-local-"));
    directories.push(directory);
    const env = { ...process.env };
    // Inheriting a developer's own connection would make this prove nothing.
    delete env.SEORAK_WORKER_URL;
    delete env.SEORAK_INGEST_KEY;
    delete env.SEORAK_READ_KEY;

    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        fileURLToPath(new URL("../bin/daemon.mjs", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          ...env,
          SEORAK_DIR: directory,
          SEORAK_LOCAL_PLANE_PORT: String(planePort),
          SEORAK_CODEX: "0",
          SEORAK_MOMENTUM: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.add(child);
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (value: string) => {
      stdout += value;
    });
    child.stderr!.on("data", (value: string) => {
      stderr += value;
    });

    try {
      await waitFor(
        () => stdout.includes("[seorak/collector] local data plane on"),
        child,
        () => stdout + stderr,
      );
      expect(stdout).toContain("local only, no worker configured");

      const res = await fetch(`http://127.0.0.1:${planePort}/data-plane`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        descriptor: { authority: "local", credentialRequired: false },
      });

      // The compatibility mirror is acknowledged locally, so delivery never
      // enters a retry loop and `seorak status` stays honest about a healthy
      // machine.
      const statusPath = join(directory, "shipping-status.json");
      await waitFor(() => existsSync(statusPath), child, () => stdout + stderr);
      expect(JSON.parse(readFileSync(statusPath, "utf8"))).toMatchObject({
        state: "caught-up",
      });

      const exited = waitForExit(child);
      child.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(stderr).toBe("");
    } finally {
      // The listener is owned by the child; killing it releases the port.
    }
  });
});
