import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectorExecutableDirectory,
  collectorPackageRoot,
} from "../src/package-layout.ts";
import { COLLECTOR_PACKAGE } from "../src/package-name.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("collector package layout", () => {
  // `npx <pkg>` picks the bin named after the package. The scoped name needed a
  // `collector` alias to give npm exec anything to choose; naming the package
  // for the product means the CLI's own binary is already the match, so
  // `npx seorak setup` resolves with no alias at all. This asserts the two stay
  // in agreement — rename one without the other and the on-ramp dies with
  // "could not determine executable to run".
  it("gives npm exec a binary matching the package name", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { name: string; bin: Record<string, string> };
    expect(manifest.name).toBe(COLLECTOR_PACKAGE);
    expect(manifest.name.startsWith("@")).toBe(false);
    expect(manifest.bin[manifest.name]).toBe("dist/seorak.mjs");
  });

  it("resolves the package root from source and nested bundle modules", () => {
    expect(
      collectorPackageRoot(
        pathToFileURL(join(PACKAGE_ROOT, "src", "install.ts")).href,
      ),
    ).toBe(PACKAGE_ROOT);
    expect(
      collectorPackageRoot(
        pathToFileURL(join(PACKAGE_ROOT, "dist", "chunks", "shared.mjs")).href,
      ),
    ).toBe(PACKAGE_ROOT);
  });

  it("keeps source installs on bin and published installs on dist", () => {
    expect(
      collectorExecutableDirectory(
        pathToFileURL(join(PACKAGE_ROOT, "src", "install.ts")).href,
      ),
    ).toBe(join(PACKAGE_ROOT, "bin"));
    expect(
      collectorExecutableDirectory(
        pathToFileURL(join(PACKAGE_ROOT, "dist", "chunks", "shared.mjs")).href,
      ),
    ).toBe(join(PACKAGE_ROOT, "dist"));
  });
});
