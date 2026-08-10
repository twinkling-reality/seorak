/*
 * The barrel is the module every surface imports, including the one that gets
 * downloaded over the network into a browser. Whatever `src/index.ts` re-exports,
 * the dashboard pays for.
 *
 * `export *` is the specific hazard. It gives the bundler a module whose scope is
 * evaluated for its side effects, so a schema built at module load — `const X =
 * z.object(...)` — cannot be tree-shaken away by a consumer who never names it.
 * Measured on 2026-07-27: `event-validation.ts` and `push.ts` sat in this barrel
 * and dragged a complete second zod runtime (v4, beside the v3 the web already
 * bundled) plus the APNs wire contract into the dashboard chunk. 93,058 bytes for
 * an ingest validator and a push payload shape that no browser code path calls.
 *
 * Both now live on their own subpath (`@seorak/types/event-validation`,
 * `@seorak/types/push`), which is where anything with a runtime cost belongs:
 * reachable by name for the worker, the push service and the collector, invisible
 * to a consumer who only wanted a type.
 *
 * The rule this file enforces is the general one rather than those two names,
 * because naming them would only stop the exact regression that already happened.
 * There is a byte ceiling on the dashboard chunk too (see packages/web/
 * vite.config.ts), but that gate reports a number, while this one reports which
 * import caused it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

function read(module: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(module, SRC)), "utf8");
  } catch {
    return null;
  }
}

/** Every `./x.ts` this module pulls in, whether re-exported or imported. */
function localDeps(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:from|import)\s+"(\.\/[\w.-]+\.ts)"/g)) {
    out.add(m[1].slice(2));
  }
  return [...out];
}

function importsZod(code: string): boolean {
  return /from\s+"zod(?:\/[\w-]+)?"/.test(code);
}

/**
 * Packages that carry a zod runtime of their own. Importing one of these for a
 * VALUE costs the same as importing zod directly; importing one for a TYPE costs
 * nothing, because `import type` is erased before the bundler ever sees it.
 *
 * `@mobile-surfaces/tokens` is the sharp one: it depends on zod 4.3.6 and peers
 * on `expo` and `react-native`. It reached this package only through `push.ts`,
 * so it left the barrel along with it.
 */
const ZOD_BEARING_PACKAGES = [
  "@mobile-surfaces/surface-contracts",
  "@mobile-surfaces/tokens",
  "@mobile-surfaces/live-activity",
  "@mobile-surfaces/traps",
];

/**
 * Value (non-type) imports of a zod-bearing package. The distinction is the whole
 * point: the barrel legitimately re-exports TYPES from surface-contracts today,
 * and that is free. Deleting the `type` keyword would not fail a typecheck and
 * would not fail any test that only counted imports — it would just quietly put
 * a second zod runtime back in the browser.
 */
function valueImportsOfZodBearing(code: string): string[] {
  const hits: string[] = [];
  for (const pkg of ZOD_BEARING_PACKAGES) {
    const escaped = pkg.replace(/[/\-@]/g, "\\$&");
    // Matches `import ... from "pkg"` / `export ... from "pkg"` but NOT when the
    // statement is `import type` / `export type`, and not when every named
    // specifier is individually marked `type`.
    // The clause may span lines (a braced specifier list usually does) but must
    // not cross a statement boundary. Without the `;` exclusion the match starts
    // at the FIRST `export` in the file and swallows every statement in between,
    // which reports the wrong module and misreads a type-only re-export as a
    // value import.
    const stmt = new RegExp(`(?:^|\\n)\\s*(import|export)\\s+([^;]*?)from\\s+"${escaped}"`, "g");
    for (const m of code.matchAll(stmt)) {
      const clause = m[2];
      if (/^\s*type\s/.test(clause)) continue;
      const named = clause.match(/\{([\s\S]*)\}/);
      if (named) {
        const specs = named[1].split(",").map((s) => s.trim()).filter(Boolean);
        if (specs.length > 0 && specs.every((s) => /^type\s/.test(s))) continue;
      }
      hits.push(pkg);
    }
  }
  return hits;
}

/**
 * Barrel reachability, transitively. A module one hop away costs the browser
 * exactly as much as one named directly, so the walk does not stop at depth 1.
 * Returns the import chain to each reachable module, which is what makes a
 * failure actionable: the offending module is rarely the one you edited.
 */
function reachableFromBarrel(): Map<string, string[]> {
  const barrel = read("index.ts");
  assert.ok(barrel, "src/index.ts must exist");

  // index.ts is a member of its own reachable set, not merely the walk's root.
  // It carries imports of its own — it re-exports types straight from
  // surface-contracts — and an earlier version of this walk seeded the queue with
  // index.ts's dependencies while never examining index.ts, so a bad import
  // written directly in the barrel was the one thing the barrel guard missed.
  const found = new Map<string, string[]>();
  const queue: Array<{ module: string; chain: string[] }> = [
    { module: "index.ts", chain: ["index.ts"] },
  ];

  while (queue.length > 0) {
    const { module, chain } = queue.shift()!;
    if (found.has(module)) continue;
    found.set(module, chain);
    const code = read(module);
    if (!code) continue;
    for (const dep of localDeps(code)) {
      if (!found.has(dep)) queue.push({ module: dep, chain: [...chain, dep] });
    }
  }
  return found;
}

test("nothing reachable from the barrel imports zod", () => {
  const offenders: string[] = [];
  for (const [module, chain] of reachableFromBarrel()) {
    const code = read(module);
    if (code && importsZod(code)) offenders.push(`${module} (via ${chain.join(" -> ")})`);
  }

  assert.deepEqual(
    offenders,
    [],
    "these modules put a zod runtime in every browser bundle that imports " +
      "@seorak/types; move them to a subpath in package.json exports and import " +
      `them by that subpath instead:\n  ${offenders.join("\n  ")}`,
  );
});

test("the barrel reaches zod-bearing packages only for types", () => {
  const offenders: string[] = [];
  for (const [module, chain] of reachableFromBarrel()) {
    const code = read(module);
    if (!code) continue;
    for (const pkg of valueImportsOfZodBearing(code)) {
      offenders.push(`${module} imports ${pkg} for a value (via ${chain.join(" -> ")})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a value import pulls the package's zod runtime into every browser bundle. " +
      "If only the types are needed, say `import type`, which is erased:\n  " +
      offenders.join("\n  "),
  );
});

test("the two modules that cost 93KB stay off the barrel and stay reachable", () => {
  // The general rule above is what protects the future. This pins the specific
  // pair, so deleting the subpaths or quietly re-adding the `export *` is a named
  // failure rather than a byte count someone raises a ceiling for.
  const reachable = reachableFromBarrel();
  for (const module of ["event-validation.ts", "push.ts"]) {
    assert.equal(
      reachable.has(module),
      false,
      `${module} is back on the barrel; it builds zod schemas at module scope`,
    );
  }

  const pkg = JSON.parse(read("../package.json") ?? "{}") as {
    exports?: Record<string, { import?: string }>;
  };
  assert.equal(
    pkg.exports?.["./event-validation"]?.import,
    "./dist/event-validation.js",
  );
  assert.equal(pkg.exports?.["./push"]?.import, "./dist/push.js");
});

test("the guard is not vacuous", () => {
  // If the walk ever returns nothing, both tests above pass while checking air.
  const reachable = reachableFromBarrel();
  assert.ok(
    reachable.size >= 20,
    `barrel walk reached only ${reachable.size} modules; the parser is likely broken`,
  );
  assert.ok(reachable.has("events.ts"), "walk missed a module the barrel plainly exports");

  // And prove the zod detector actually fires on the shape it is looking for.
  assert.equal(importsZod('import { z } from "zod";'), true);
  assert.equal(importsZod('import { z } from "zod/v4";'), true);
  assert.equal(importsZod('import type { Foo } from "./foo.ts";'), false);

  // The type-only detector is the subtle one, and its first version was wrong in
  // both directions: it matched across statement boundaries, so a file with any
  // earlier export read as a value import. Both directions are pinned here
  // because a detector that never fires and one that always fires are equally
  // useless, and neither shows up as a failing test on the day it breaks.
  const P = "@mobile-surfaces/surface-contracts";
  assert.deepEqual(valueImportsOfZodBearing(`import { thing } from "${P}";`), [P]);
  assert.deepEqual(valueImportsOfZodBearing(`export { thing } from "${P}";`), [P]);
  assert.deepEqual(valueImportsOfZodBearing(`import type { T } from "${P}";`), []);
  assert.deepEqual(valueImportsOfZodBearing(`export type {\n  A,\n  B,\n} from "${P}";`), []);
  // Per-specifier `type` markers count as type-only; a bare one alongside does not.
  assert.deepEqual(valueImportsOfZodBearing(`import { type A, type B } from "${P}";`), []);
  assert.deepEqual(valueImportsOfZodBearing(`import { type A, B } from "${P}";`), [P]);
  // The statement-boundary bug: a preceding export must not be misattributed.
  assert.deepEqual(
    valueImportsOfZodBearing(`export * from "./api.ts";\nexport type { A } from "${P}";`),
    [],
  );
});
