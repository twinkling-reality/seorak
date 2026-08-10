import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

function isCollectorRoot(candidate: string): boolean {
  const manifestPath = join(candidate, "package.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
    };
    return manifest.name === "@seorak/collector";
  } catch {
    return false;
  }
}

/** Locate the package root from either a source module or a bundled dist chunk. */
export function collectorPackageRoot(moduleUrl: string = import.meta.url): string {
  let candidate = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (isCollectorRoot(candidate)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error("cannot locate the @seorak/collector package root");
    }
    candidate = parent;
  }
}

/**
 * Source checkouts execute wrappers from bin/. Published bundles execute every
 * long-lived entry from dist/. The module URL, not the presence of a stale build,
 * decides which layout owns hook and daemon paths.
 */
export function collectorExecutableDirectory(
  moduleUrl: string = import.meta.url,
): string {
  const packageRoot = collectorPackageRoot(moduleUrl);
  const modulePath = relative(packageRoot, fileURLToPath(moduleUrl));
  const bundled =
    modulePath === "dist" || modulePath.startsWith(`dist${sep}`);
  return join(packageRoot, bundled ? "dist" : "bin");
}
