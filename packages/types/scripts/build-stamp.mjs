/**
 * The build stamp: what `dist/` was built FROM, recorded next to it.
 *
 * `@seorak/types` is consumed through `dist/` — every `exports` condition in the
 * manifest points there — and `dist/` is gitignored. Three things write it: the
 * root `postinstall`, `npm run typecheck`, and `prepack` when the package is
 * packed. None of them is something a developer runs while changing a file, so a
 * checkout that changes `src/` and runs none of them leaves every consumer
 * importing the PREVIOUS contract while the source in front of the reader says
 * otherwise.
 *
 * That is not a theoretical failure. A shared zod parser built from an older
 * `src/data-plane.ts` rejects a descriptor carrying a surface the newer source
 * declares, `parseDataPlaneStatus` and `parseDataPlaneDescriptor` return null,
 * and two suites fail with five failures each in code that is correct. It reads
 * exactly like a semantic conflict between branches, and it costs whoever hits it
 * the time to prove that it is not one.
 *
 * WHY A STAMP AND NOT MTIMES. A timestamp comparison would be the obvious check
 * and it would be wrong: `git checkout` rewrites the mtime of every file it
 * touches and leaves the rest alone, so a tree that is stale can look fresh and a
 * tree that is fresh can look stale. The stamp is a hash over the CONTENT of
 * every input the build reads, which changes when and only when the input does.
 *
 * WHAT COUNTS AS AN INPUT. Every file under `src/`, because esbuild bundles from
 * the entry points and `tsc` compiles the whole `include`; both tsconfigs, since
 * `tsconfig.publish.json` extends `tsconfig.json` and either one changes what is
 * emitted; `scripts/build-package.mjs`, which holds the entry list and every
 * esbuild option; and the pinned versions of the two tools that do the work plus
 * `zod`. `zod` is not inlined — `dist/push.d.ts` imports it by specifier — but a
 * schema library upgrade can still change what `tsc` emits for a value inferred
 * from one of its builders, so it is covered rather than argued about.
 *
 * The hash covers each input's path as well as its bytes, so a rename with
 * identical content is a different build. It never reads a clock, an environment
 * variable, or an absolute path, so two machines with the same tree agree.
 *
 * This module is deliberately here rather than under the repository's `scripts/`:
 * the build that writes the stamp and the gate that verifies it must compute the
 * same number, and a second implementation of "what did we build from" is how the
 * two would drift apart while both stayed green.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** `packages/types`, when nobody names another root (the tests do). */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the stamp lives, relative to the package root. */
export const STAMP_PATH = "dist/.build-stamp.json";

/** Everything compiled, relative to the package root. */
export const SOURCE_ROOT = "src";

/** Inputs that are not source: what the build reads to decide how to build. */
export const CONFIG_INPUTS = [
  "scripts/build-package.mjs",
  "tsconfig.json",
  "tsconfig.publish.json",
];

/**
 * Pinned packages whose version changes the bytes in `dist/`. `esbuild` emits the
 * JavaScript, `typescript` emits the declarations, and `zod`'s types are inlined
 * into those declarations by inference.
 */
export const TOOL_INPUTS = ["esbuild", "typescript", "zod"];

/**
 * Bumped when the hash's own definition changes. A stamp written by an older
 * definition is not comparable to one written by a newer one, and reporting that
 * as staleness (rebuild, and it agrees again) is the safe direction.
 */
export const STAMP_VERSION = 1;

function toPosix(path) {
  return sep === "/" ? path : path.split(sep).join(posix.sep);
}

/**
 * Every file under `src/`, as package-relative POSIX paths, sorted. Sorted
 * because `readdirSync` order is a property of the filesystem, and a hash that
 * depended on it would differ between two identical trees.
 */
export function sourceFiles(packageRoot = PACKAGE_ROOT) {
  const root = join(packageRoot, SOURCE_ROOT);
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(toPosix(path.slice(packageRoot.length + 1)));
    }
  };
  walk(root);
  return found.sort();
}

function hashFile(packageRoot, relativePath) {
  const path = join(packageRoot, relativePath);
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toolVersions(packageRoot) {
  const path = join(packageRoot, "package.json");
  if (!existsSync(path)) return TOOL_INPUTS.map((name) => `${name}@absent`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return TOOL_INPUTS.map((name) => {
    const version =
      manifest.devDependencies?.[name] ?? manifest.dependencies?.[name] ?? "absent";
    return `${name}@${version}`;
  });
}

/**
 * The stamp a build of this tree would write. Content only: no clock, no
 * absolute path, no environment.
 */
export function computeBuildStamp(packageRoot = PACKAGE_ROOT) {
  const files = sourceFiles(packageRoot);
  const hash = createHash("sha256");
  hash.update(`stamp-version ${STAMP_VERSION}\n`);
  for (const relativePath of [...files, ...CONFIG_INPUTS]) {
    hash.update(`${relativePath} ${hashFile(packageRoot, relativePath)}\n`);
  }
  for (const tool of toolVersions(packageRoot)) hash.update(`${tool}\n`);
  return { version: STAMP_VERSION, sources: files.length, hash: hash.digest("hex") };
}

/** The stamp `dist/` carries, or null when it carries none. */
export function readBuildStamp(packageRoot = PACKAGE_ROOT) {
  const path = join(packageRoot, STAMP_PATH);
  if (!existsSync(path)) return null;
  try {
    const stamp = JSON.parse(readFileSync(path, "utf8"));
    return typeof stamp?.hash === "string" ? stamp : null;
  } catch {
    return null;
  }
}

/** Record what this build compiled. Called by `build-package.mjs`, last. */
export function writeBuildStamp(packageRoot = PACKAGE_ROOT) {
  const stamp = computeBuildStamp(packageRoot);
  const path = join(packageRoot, STAMP_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
  return stamp;
}
