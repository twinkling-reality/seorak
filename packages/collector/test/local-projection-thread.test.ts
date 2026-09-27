import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProjectionThread,
  projectionWorkerEntry,
} from "../src/local-projection-thread.ts";
import { collectorPackageRoot } from "../src/package-layout.ts";
import { openLocalHistory } from "../src/local-store.ts";

let dir: string;
let thread: ProjectionThread;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seorak-projection-thread-"));
  // Create the schema up front so the worker folds a real, empty history rather
  // than racing the first open.
  openLocalHistory(dir).close();
  thread = new ProjectionThread();
});

afterEach(async () => {
  await thread.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

const request = (rangeDays: number) =>
  ({
    kind: "overview",
    directory: dir,
    nowMs: NOW,
    rangeDays,
    archivedRepoIds: [],
  }) as const;

describe("ProjectionThread", () => {
  it("builds an overview off the main thread", async () => {
    const snapshot = (await thread.build(request(7), "k7")) as {
      rangeDays: number;
      generatedAt: string;
    };
    expect(snapshot.rangeDays).toBe(7);
    expect(Number.isFinite(Date.parse(snapshot.generatedAt))).toBe(true);
  });

  it("coalesces concurrent callers on one key into a single build", async () => {
    const a = thread.build(request(7), "same");
    const b = thread.build(request(7), "same");
    // Identity, not deep equality: the point is that ONE build ran and both
    // callers were handed its result.
    expect(a).toBe(b);
    await expect(a).resolves.toBeDefined();
  });

  it("does not coalesce different keys", async () => {
    const a = thread.build(request(7), "k7");
    const b = thread.build(request(30), "k30");
    expect(a).not.toBe(b);
    const [seven, thirty] = (await Promise.all([a, b])) as Array<{
      rangeDays: number;
    }>;
    expect(seven.rangeDays).toBe(7);
    expect(thirty.rangeDays).toBe(30);
  });

  it("releases a key once its build settles, so a later caller rebuilds", async () => {
    const first = thread.build(request(7), "k7");
    await first;
    const second = thread.build(request(7), "k7");
    expect(second).not.toBe(first);
    await expect(second).resolves.toBeDefined();
  });

  it("rejects rather than throwing once closed, which is what reaches the inline fallback", async () => {
    await thread.close();
    await expect(thread.build(request(7), "k7")).rejects.toThrow(
      /worker unavailable/,
    );
  });

  it("close is idempotent", async () => {
    await thread.close();
    await expect(thread.close()).resolves.toBeUndefined();
  });
});

describe("projectionWorkerEntry", () => {
  const packageRoot = collectorPackageRoot();

  it("resolves the source entry from a src module, not a chunk-relative guess", () => {
    const entry = projectionWorkerEntry();
    expect(entry).toBe(join(packageRoot, "src", "local-projection-worker.ts"));
    expect(existsSync(entry!)).toBe(true);
  });

  it("resolves the built entry from a bundled chunk, which is the shipped layout", () => {
    const fromChunk = pathToFileURL(
      join(packageRoot, "dist", "chunks", "some-chunk-ABC123.mjs"),
    ).href;
    const built = join(packageRoot, "dist", "local-projection-worker.mjs");
    // Only assert the resolution when a build is present; the shape of the
    // answer is the contract, and an unbuilt checkout honestly has no dist.
    if (existsSync(built)) {
      expect(projectionWorkerEntry(fromChunk)).toBe(built);
    } else {
      expect(projectionWorkerEntry(fromChunk)).toBeNull();
    }
  });

  it("returns null rather than a path when the module is outside the package", () => {
    expect(projectionWorkerEntry(pathToFileURL("/x.mjs").href)).toBeNull();
  });
});
