/**
 * toolchain.ts — detect a repo's package manager + framework ON-MACHINE and ship
 * only the closed enums (CAPTURE-FOUNDATION ADR-CF3).
 *
 * packageManager: lockfile presence ONLY (existsSync — ZERO content read).
 * framework: the manifest is read (size-capped, fail-soft) to match its dependency
 * KEYS against a CLOSED table, and then DISCARDED — no dep name, path, version, or
 * manifest string ever leaves this module. A miss returns null (honest-empty).
 *
 * Runs at session-start only (never on the tool.call hot path). Every read is
 * size-capped and every parse fault-soft, so a huge or corrupt manifest degrades
 * to null, never a throw or a hang.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Framework, PackageManager } from "@seorak/types";

/** Never read a manifest larger than this (a pathological/vendored file → skip). */
const MANIFEST_MAX_BYTES = 512 * 1024;

/** Lockfile → package manager, in detection priority (most specific first). */
const LOCKFILES: Array<[string, PackageManager]> = [
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Pipfile.lock", "pipenv"],
  ["requirements.txt", "pip"],
  ["Cargo.lock", "cargo"],
  ["go.sum", "gomod"],
  ["go.mod", "gomod"],
  ["Gemfile.lock", "bundler"],
  ["composer.lock", "composer"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
];

/** package.json dependency KEY → framework, in priority order (meta-frameworks
 *  before their base, so Next beats React and SvelteKit beats Svelte). */
const JS_FRAMEWORK_BY_DEP: Array<[string, Framework]> = [
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["@remix-run/react", "remix"],
  ["@remix-run/node", "remix"],
  ["@sveltejs/kit", "sveltekit"],
  ["astro", "astro"],
  ["expo", "expo"],
  ["react-native", "react-native"],
  ["electron", "electron"],
  ["@angular/core", "angular"],
  ["solid-js", "solid"],
  ["@nestjs/core", "nest"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["react", "react"],
  ["vue", "vue"],
  ["svelte", "svelte"],
];

/** Read a manifest at `path`, or null (absent, over the size cap, or unreadable).
 *  Size-capped + fault-soft: the returned string is used only to match closed
 *  tables and is never emitted. */
function readManifest(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const size = statSync(path).size;
    if (size > MANIFEST_MAX_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Detect the package manager from lockfile presence (existsSync only). */
export function detectPackageManager(cwd: string): PackageManager | null {
  for (const [file, manager] of LOCKFILES) {
    try {
      if (existsSync(join(cwd, file))) return manager;
    } catch {
      // permission/other fs error → treat as absent, keep scanning
    }
  }
  return null;
}

/** Match a whole-word token in a manifest's text (for non-JSON manifests where a
 *  dep KEY is not cheaply extractable). Anchored to word boundaries so "flask"
 *  does not match "flaskish". */
function hasToken(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

/** Detect the primary framework by matching manifest dependency KEYS against the
 *  closed table, then discarding the manifest. Returns null when nothing matches. */
export function detectFramework(cwd: string): Framework | null {
  // 1. package.json — the richest signal. Match dependency KEYS (not values).
  const pkgRaw = readManifest(join(cwd, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        peerDependencies?: Record<string, unknown>;
      };
      const deps = new Set<string>([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
      for (const [dep, framework] of JS_FRAMEWORK_BY_DEP) {
        if (deps.has(dep)) return framework;
      }
    } catch {
      // malformed package.json → fall through to the other ecosystems
    }
  }

  // 2. Python — token scan of the declared-deps manifest (no cheap key parse).
  const py =
    readManifest(join(cwd, "pyproject.toml")) ??
    readManifest(join(cwd, "requirements.txt")) ??
    readManifest(join(cwd, "Pipfile"));
  if (py) {
    if (hasToken(py, "django")) return "django";
    if (hasToken(py, "fastapi")) return "fastapi";
    if (hasToken(py, "flask")) return "flask";
  }

  // 3. Ruby (Rails), PHP (Laravel), JVM (Spring).
  const gemfile = readManifest(join(cwd, "Gemfile"));
  if (gemfile && hasToken(gemfile, "rails")) return "rails";

  const composer = readManifest(join(cwd, "composer.json"));
  if (composer && hasToken(composer, "laravel")) return "laravel";

  const jvm =
    readManifest(join(cwd, "pom.xml")) ??
    readManifest(join(cwd, "build.gradle")) ??
    readManifest(join(cwd, "build.gradle.kts"));
  if (jvm && (hasToken(jvm, "spring-boot") || hasToken(jvm, "springframework"))) return "spring";

  return null;
}

/** Detect both toolchain facets for `cwd`. Both null when nothing is detected —
 *  the caller then emits no repo.toolchain event (no signal). */
export function detectToolchain(cwd: string): {
  packageManager: PackageManager | null;
  framework: Framework | null;
} {
  return { packageManager: detectPackageManager(cwd), framework: detectFramework(cwd) };
}
