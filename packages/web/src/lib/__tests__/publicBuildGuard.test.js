import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  assertNoForbiddenPublicEnv,
  assertNoForbiddenPublicOutput,
  loadPublicBuildEnv,
} from "../../../scripts/public-build-guard.mjs";

const DENYLISTED_NAME = "VITE_SEORAK_INGEST_KEY";
const TEST_CANARY = "seorak-test-only-browser-secret-canary-7b3f1";
const tempRoots = [];

async function outputDir() {
  const root = await mkdtemp(join(tmpdir(), "seorak-web-build-guard-"));
  tempRoots.push(root);
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  return dist;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public web build guard", () => {
  it("accepts an empty denylisted variable", () => {
    expect(() => assertNoForbiddenPublicEnv({ [DENYLISTED_NAME]: "" })).not.toThrow();
  });

  it("honors an explicit empty process override over any legacy env file", () => {
    const env = loadPublicBuildEnv("production", {
      [DENYLISTED_NAME]: "",
    });

    expect(env[DENYLISTED_NAME]).toBe("");
    expect(() => assertNoForbiddenPublicEnv(env)).not.toThrow();
  });

  it("rejects a nonempty denylisted variable without logging its value", () => {
    let message = "";
    try {
      assertNoForbiddenPublicEnv({ [DENYLISTED_NAME]: TEST_CANARY });
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain(DENYLISTED_NAME);
    expect(message).not.toContain(TEST_CANARY);
  });

  it("rejects a matching emitted canary without logging its value", async () => {
    const dist = await outputDir();
    await writeFile(join(dist, "assets", "app.js"), `window.__test = "${TEST_CANARY}"`);

    let message = "";
    try {
      await assertNoForbiddenPublicOutput(dist, { [DENYLISTED_NAME]: TEST_CANARY });
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain(DENYLISTED_NAME);
    expect(message).toContain("assets/app.js");
    expect(message).not.toContain(TEST_CANARY);
  });

  it("rejects a denylisted variable reference even when its value is empty", async () => {
    const dist = await outputDir();
    await writeFile(join(dist, "assets", "app.js"), `window.__env = "${DENYLISTED_NAME}"`);

    await expect(
      assertNoForbiddenPublicOutput(dist, { [DENYLISTED_NAME]: "" }),
    ).rejects.toThrow(/variable reference/);
  });

  it("accepts output with no denylisted reference or value", async () => {
    const dist = await outputDir();
    await writeFile(join(dist, "assets", "app.js"), "window.__workerUrl = '/overview'");

    await expect(
      assertNoForbiddenPublicOutput(dist, { [DENYLISTED_NAME]: "" }),
    ).resolves.toBeUndefined();
  });
});
