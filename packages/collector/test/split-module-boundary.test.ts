/**
 * The git and emit layers were split behind THIN facades (`src/git.ts`, `src/emit.ts`).
 * A facade is only a facade while it is the ONLY path: the moment a consumer reaches
 * past it into `src/git/*` or `src/emit/*`, there are two working paths, the facade
 * stops describing the layer, and the emit tripwire in particular stops being
 * unavoidable.
 *
 * These assertions name the CONCRETE module files rather than asserting a property of
 * whatever happens to be in the directory, because a boundary test that reads the
 * directory it is guarding goes quiet the moment the directory is renamed. If a module
 * here is renamed or removed, the "every internal module is reachable" assertion fails
 * loudly and this list must be updated with it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url);

const GIT_INTERNALS = [
  "runner.ts",
  "identity.ts",
  "repo-state.ts",
  "numstat.ts",
  "momentum.ts",
  "session-delta.ts",
  "history.ts",
  "line-survival.ts",
] as const;

const EMIT_INTERNALS = ["guard.ts", "registry.ts", "validators.ts"] as const;

/** Every .ts/.mjs file under src/ and bin/, so a new bypass cannot hide in a new file. */
function sourceFilesUnder(root: URL): URL[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), root);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return /\.(?:[cm]?js|ts)$/.test(entry.name) ? [child] : [];
  });
}

const collectorRoot = new URL("..", import.meta.url);
const allSources = [
  ...sourceFilesUnder(new URL("./src/", collectorRoot)),
  ...sourceFilesUnder(new URL("./bin/", collectorRoot)),
  ...sourceFilesUnder(new URL("./test/", collectorRoot)),
];

/** Files that legitimately import a layer's internals: the facade, and the layer's own
 *  siblings. Everything else must go through the facade. */
function importersOutside(layer: "git" | "emit", internals: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const url of allSources) {
    const rel = url.pathname.slice(collectorRoot.pathname.length);
    if (rel === `src/${layer}.ts`) continue; // the facade itself
    if (rel.startsWith(`src/${layer}/`)) continue; // siblings inside the layer
    const source = readFileSync(url, "utf8");
    for (const module of internals) {
      const stem = module.replace(/\.ts$/, "");
      // Matches any specifier ending in `<layer>/<stem>.ts`, however it is spelled
      // relatively ("./git/runner.ts", "../src/git/runner.ts", "../../git/runner.ts").
      const re = new RegExp(`from\\s*["'][^"']*${layer}/${stem}\\.ts["']`);
      if (re.test(source)) offenders.push(`${rel} -> ${layer}/${module}`);
    }
  }
  return offenders;
}

describe("git layer facade", () => {
  it("keeps src/git.ts free of logic (a re-export facade only)", () => {
    const facade = readFileSync(new URL("./git.ts", SRC), "utf8");
    // Strip the block comment header so its prose cannot satisfy or trip these checks.
    const code = facade.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/export \{/);
    // No function bodies, no control flow, no spawn: those all belong in git/.
    expect(code).not.toMatch(/\bfunction\b/);
    expect(code).not.toMatch(/\bspawnSync\b/);
    expect(code).not.toMatch(/\bif\s*\(/);
    expect(code).not.toMatch(/=>/);
  });

  it("is the ONLY path into the git layer", () => {
    expect(importersOutside("git", GIT_INTERNALS)).toEqual([]);
  });

  it("re-exports every internal git module, so none is dead or orphaned", () => {
    const facade = readFileSync(new URL("./git.ts", SRC), "utf8");
    for (const module of GIT_INTERNALS) {
      if (module === "runner.ts") {
        // The guarded spawn layer is deliberately NOT re-exported: no caller outside
        // git/ may run a raw git command, which is what keeps every git read in the
        // collector uniformly timeout-bounded and fail-soft.
        expect(facade).not.toContain(`./git/${module}`);
        continue;
      }
      expect(facade, `git.ts must re-export ./git/${module}`).toContain(`./git/${module}`);
    }
  });

  it("keeps the git layer's spawnSync confined to git/runner.ts", () => {
    const spawnersInLayer = allSources
      .map((url) => url.pathname.slice(collectorRoot.pathname.length))
      .filter((rel) => rel.startsWith("src/git/"))
      .filter((rel) => readFileSync(new URL(rel, collectorRoot), "utf8").includes("spawnSync("));
    expect(spawnersInLayer).toEqual(["src/git/runner.ts"]);
  });

  it("has exactly two modules that spawn git, and names the known duplicate", () => {
    // `repo-shape.ts` carries its OWN copy of the guarded reader. Its stated reason was
    // that git.ts's reader was PRIVATE, which the split into git/runner.ts dissolves —
    // so this is a reported, not an accepted, duplicate. Pinned here so a THIRD guarded
    // git reader cannot appear silently, and so removing the duplicate has to come
    // through this list rather than past it.
    const gitSpawners = allSources
      .map((url) => url.pathname.slice(collectorRoot.pathname.length))
      .filter((rel) => rel.startsWith("src/"))
      .filter((rel) => /spawnSync\(\s*"git"/.test(readFileSync(new URL(rel, collectorRoot), "utf8")))
      .sort();
    expect(gitSpawners).toEqual(["src/git/runner.ts", "src/repo-shape.ts"]);
  });
});

describe("emit layer facade", () => {
  it("is the ONLY path into the emit layer", () => {
    expect(importersOutside("emit", EMIT_INTERNALS)).toEqual([]);
  });

  it("keeps assertEmitSafe in src/emit.ts, so no caller can reach a validator directly", () => {
    const facade = readFileSync(new URL("./emit.ts", SRC), "utf8");
    expect(facade).toMatch(/export function assertEmitSafe/);
    // The deep validators are dispatched, never re-exported: a caller that could call
    // one directly could run a deep check WITHOUT the top-level key-check that must
    // precede it.
    expect(facade).not.toMatch(/export \{[^}]*DEEP_VALIDATORS/s);
    const validators = readFileSync(new URL("./emit/validators.ts", SRC), "utf8");
    expect(validators).not.toMatch(/export function validate/);
  });

  it("keeps exactly ONE registry: only emit/registry.ts declares EMIT_ALLOWLIST", () => {
    const declaring = allSources
      .filter((url) => /(?:const|let|var)\s+EMIT_ALLOWLIST/.test(readFileSync(url, "utf8")))
      .map((url) => url.pathname.slice(collectorRoot.pathname.length));
    expect(declaring).toEqual(["src/emit/registry.ts"]);
  });

  it("routes every append through assertEmitSafe", () => {
    const append = readFileSync(new URL("./append.ts", SRC), "utf8");
    expect(append).toContain("assertEmitSafe");
    expect(append).toContain("./emit.ts");
  });
});

describe("enforcement claims in source docs", () => {
  it("cites only test files that exist", () => {
    // Both facades tell the reader "a test enforces this". Both originally named a
    // test file that was never created, which is the exact failure mode of a guard
    // that is really just a docstring: it reads as enforcement and enforces nothing.
    // A citation that cannot be followed is worse than no citation, so the pointers
    // themselves are checked.
    const cited = new Map<string, string[]>();
    for (const url of allSources) {
      const rel = url.pathname.slice(collectorRoot.pathname.length);
      if (!rel.startsWith("src/") && !rel.startsWith("bin/")) continue;
      for (const m of readFileSync(url, "utf8").matchAll(/test\/[A-Za-z0-9._-]+\.test\.ts/g)) {
        cited.set(m[0], [...(cited.get(m[0]) ?? []), rel]);
      }
    }
    // Non-vacuous only if something is actually cited.
    expect(cited.size).toBeGreaterThan(0);
    const dangling = [...cited].filter(
      ([test]) => !existsSync(new URL(test, collectorRoot)),
    );
    expect(dangling).toEqual([]);
  });
});

describe("append routing", () => {
  it("routes every append through assertEmitSafe", () => {
    const append = readFileSync(new URL("./append.ts", SRC), "utf8");
    expect(append).toContain("assertEmitSafe");
    expect(append).toContain("./emit.ts");
  });
});
