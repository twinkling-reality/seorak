import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectorExecutableDirectory,
  collectorPackageRoot,
} from "../src/package-layout.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("collector package layout", () => {
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
