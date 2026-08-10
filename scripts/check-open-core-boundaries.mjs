#!/usr/bin/env node

/**
 * The open-core leak detector: does anything in the public file set reach
 * something that is not in it?
 *
 * ADR 005 splits this repository into a public core and a private cloud. Today
 * nothing mechanically knows which is which, so an edge from public to private
 * is a leak that survives review, and the tree filter in phase C is where it
 * would surface, by which time the repository is public. This gate is the thing
 * that knows. The map it reads is `docs/reference/open-core-ownership.json`,
 * which is the ONLY copy; ADR 005 and CLAUDE.md point at it.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS IT LOOKS AT
 * ---------------------------------------------------------------------------
 *
 * COVERAGE. Every tracked file under the manifest's coverage roots must match
 * exactly one path rule. An unplaced file is a hard failure, not a finding,
 * because it cannot be accepted with a falsification condition: nobody has
 * decided anything about it yet. This is what makes a new directory a decision
 * rather than a silent omission, and it is the property that lets the ADR stop
 * carrying a second copy of the map. A rule that matches nothing is also a
 * failure, so deleting a directory does not leave a rule behind pretending to
 * protect it.
 *
 * IMPORTS. Every file whose visibility restricts what it may read is parsed and
 * every static edge resolved: TypeScript and JavaScript through the same
 * analyser the per-workspace gate uses, and CSS through `@import` and `url()`.
 * CSS is not an afterthought. `src/app.css` reaches the licensed typeface with
 * a root-absolute `url()` and `PublicViews.module.css` reaches the marketing
 * token file with an `@import`; an import gate that reads only JavaScript
 * reports clean on both.
 *
 * ASSET BINDINGS. `wrangler.toml` deploys directories, and a directory is
 * invisible to every import gate ever written.
 * `packages/control-plane/wrangler.toml` binds `../web/public`, so a PRIVATE
 * worker deploys the licensed fonts, the CC0 icon set, the vendored AI-tool
 * marks, and Seorak's brand assets, which the ownership map splits four ways. A
 * gate that only reads import statements reports clean on a tree that is
 * already shipping them. Every `[assets] directory` and every `[site] bucket`
 * is parsed, in the top-level table and in every `[env.*]` override.
 *
 * ---------------------------------------------------------------------------
 * MODE
 * ---------------------------------------------------------------------------
 *
 * ENFORCEMENT IS THE DEFAULT. The acceptance file at
 * `docs/reference/open-core-boundary-acceptance.json` is the escape hatch for
 * violations an owner has already seen and dated, each with the condition that
 * falsifies it. Anything undeclared fails, and an acceptance entry whose
 * violation is gone fails too. The sibling types gate shipped its enforcement
 * behind an opt-in flag and was wired into `npm test` without it, so a new
 * undeclared placement printed a line and CI stayed green; report mode has to
 * protect what is already accepted, never what nobody has discovered yet.
 *
 * `--strict` fails on accepted violations as well, which is how B1b measures
 * its own work before it empties the acceptance file.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { analyzeImports } from "./check-package-boundaries.mjs";
import {
  REPO_ROOT,
  classifyPath,
  exitCodeFor,
  formatAcceptanceSection,
  holdsPrivateHalf,
  isCovered,
  isOutOfScope,
  loadOwnership,
  mayImport,
  readAcceptance,
  reconcile,
  trackedFiles,
  workspaceForPath,
} from "./open-core-ownership.mjs";

const CHECK_ID = "open-core-boundaries";

const SCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

/** Tried in order when a specifier names no file directly. */
const RESOLUTION_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
];

/** `./x.js` in this tree usually means `./x.ts`; TypeScript's NodeNext form. */
const REWRITTEN_EXTENSIONS = new Map([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

function extensionOf(path) {
  const match = /(\.[^./]+)$/.exec(path);
  return match?.[1] ?? "";
}

function normalise(path) {
  const segments = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * CSS edges. `@import` and `url()` are the two ways a stylesheet reaches
 * another file, and both cross package boundaries as easily as an import
 * statement does. Comments are stripped first so a commented-out reference is
 * not reported.
 */
export function cssSpecifiers(source) {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const specifiers = [];
  for (const match of body.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  for (const match of body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
    specifiers.push(match[2]);
  }
  return specifiers.filter(
    (specifier) => !/^(?:data:|https?:|\/\/|#)/.test(specifier),
  );
}

/**
 * A minimal TOML reader: table headers and simple `key = "value"` pairs, which
 * is all an asset binding is. It is deliberately not a TOML parser. What it
 * must never do is silently miss a binding, so a `directory` or `bucket` key
 * whose value is not a plain quoted string is reported rather than skipped.
 */
export function assetBindings(source) {
  const bindings = [];
  const problems = [];
  let table = "";
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (line.length === 0) continue;
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      table = header[1].trim();
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const isAssetsDirectory = key === "directory" && /(^|\.)assets$/.test(table);
    const isSiteBucket = key === "bucket" && /(^|\.)site$/.test(table);
    if (!isAssetsDirectory && !isSiteBucket) continue;
    const value = /^["']([^"']*)["']$/.exec(rawValue.trim());
    if (!value) {
      problems.push(`[${table}] ${key} is not a plain string and cannot be resolved`);
      continue;
    }
    bindings.push({ table, key, value: value[1] });
  }
  return { bindings, problems };
}

function buildIndex(paths) {
  const files = new Set(paths);
  const directories = new Set();
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return { files, directories };
}

/**
 * Turn one specifier into the tracked file it names, or `undefined`. Returning
 * `undefined` for a relative specifier is itself reportable: an edge the gate
 * cannot resolve is an edge it cannot police.
 */
function resolveSpecifier(index, manifest, importer, specifier) {
  const bare = specifier.split("?")[0].split("#")[0];
  if (bare.length === 0) return undefined;
  let base;
  if (bare.startsWith("/")) {
    const workspace = workspaceForPath(manifest, importer);
    if (!workspace?.assetRoot) return undefined;
    base = normalise(`${workspace.root}/${workspace.assetRoot}/${bare}`);
  } else {
    base = normalise(`${dirname(importer)}/${bare}`);
  }
  const candidates = [base];
  const rewritten = REWRITTEN_EXTENSIONS.get(extensionOf(base));
  if (rewritten) {
    const stem = base.slice(0, base.length - extensionOf(base).length);
    for (const extension of rewritten) candidates.push(`${stem}${extension}`);
  }
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${base}${extension}`);
  if (index.directories.has(base)) {
    for (const extension of RESOLUTION_EXTENSIONS) {
      candidates.push(`${base}/index${extension}`);
    }
  }
  return candidates.find((candidate) => index.files.has(candidate));
}

function specifiersOf(path, source) {
  if (extensionOf(path) === ".css") return cssSpecifiers(source);
  if (!SCRIPT_EXTENSIONS.has(extensionOf(path))) return [];
  // Module-loader hygiene is the per-workspace gate's rule, not this one's.
  return analyzeImports(source, path, { moduleLoaders: "allowed" }).specifiers;
}

function visibilityCounts(manifest, paths) {
  const counts = new Map();
  for (const path of paths) {
    const placement = classifyPath(manifest, path);
    const visibility = placement?.visibility ?? "unplaced";
    counts.set(visibility, (counts.get(visibility) ?? 0) + 1);
  }
  return counts;
}

function describeCounts(counts) {
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([visibility, count]) => `${visibility}: ${count}`)
    .join(", ");
}

/**
 * @param holdsPrivate does this tree hold both halves of the split? False in
 * the public repository, where every private rule matches nothing by
 * construction rather than because someone deleted a directory.
 */
export function analyzeOpenCoreBoundaries(manifest, paths, readFile, holdsPrivate = true) {
  const index = buildIndex(paths);
  const problems = [];
  const findings = [];
  const add = (key, detail) => findings.push({ key, detail });

  // COVERAGE. Placement is a decision; an unplaced file means nobody made one.
  const matchedPatterns = new Set();
  let placed = 0;
  for (const path of paths) {
    if (!isCovered(manifest, path)) continue;
    const skipped = isOutOfScope(manifest, path);
    if (skipped) continue;
    const placement = classifyPath(manifest, path);
    if (placement === undefined) {
      problems.push(`${path} matches no ownership rule; place it in ${"docs/reference/open-core-ownership.json"}`);
      continue;
    }
    if (placement.ambiguousWith) {
      problems.push(
        `${path} is matched at equal specificity by disagreeing rules: ${placement.rule.pattern}, ${placement.ambiguousWith.join(", ")}`,
      );
      continue;
    }
    matchedPatterns.add(placement.rule.pattern);
    placed += 1;
  }
  const unmatchedPrivateRules = [];
  for (const rule of manifest.rules) {
    if (matchedPatterns.has(rule.pattern)) continue;
    if (paths.some((path) => rule.matcher.test(path))) continue;
    // A rule that matches nothing is normally a rule protecting a directory
    // that is gone. In the public half alone, every rule that places files on
    // the private side matches nothing BY CONSTRUCTION, and reporting each as
    // "remove it" would tell the public repository to delete the map's record
    // of what it does not carry. A rule whose files WOULD be public still
    // fails there, because that one really has lost its directory.
    const relocated = rule.relocatedTo !== undefined;
    if (!holdsPrivate && (relocated || !manifest.publicFileSet.visibilities.includes(rule.visibility))) {
      unmatchedPrivateRules.push(relocated ? `${rule.pattern} (relocated to ${rule.relocatedTo})` : rule.pattern);
      continue;
    }
    problems.push(`ownership rule ${rule.pattern} matches no tracked file; remove it`);
  }

  // IMPORTS. Only a visibility that restricts what it may read is worth
  // parsing: the private half may read the public half by design.
  const restricted = new Set(
    Object.entries(manifest.visibilities)
      .filter(([, entry]) => entry.mayImport.length < Object.keys(manifest.visibilities).length)
      .map(([name]) => name),
  );
  let scanned = 0;
  for (const path of paths) {
    const extension = extensionOf(path);
    if (extension !== ".css" && !SCRIPT_EXTENSIONS.has(extension)) continue;
    const placement = classifyPath(manifest, path);
    if (placement === undefined || !restricted.has(placement.visibility)) continue;
    scanned += 1;
    const source = readFile(path);
    for (const specifier of specifiersOf(path, source)) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const target = resolveSpecifier(index, manifest, path, specifier);
        if (target === undefined) {
          add(
            `unresolved::${path}::${specifier}`,
            `${path} (${placement.visibility}) names ${specifier}, which resolves to no tracked file, so no gate can place what it reads`,
          );
          continue;
        }
        const targetPlacement = classifyPath(manifest, target);
        const targetVisibility = targetPlacement?.visibility;
        if (targetVisibility === undefined) continue;
        if (mayImport(manifest, placement.visibility, targetVisibility)) continue;
        add(
          `import::${path}::${specifier}`,
          `${path} (${placement.visibility}) reads ${target} (${targetVisibility})`,
        );
        continue;
      }
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      const workspace = manifest.workspaces.find((entry) => entry.package === packageName);
      if (workspace === undefined) continue;
      if (mayImport(manifest, placement.visibility, workspace.visibility)) continue;
      add(
        `import::${path}::${specifier}`,
        `${path} (${placement.visibility}) reads ${packageName} (${workspace.visibility})`,
      );
    }
  }

  // ASSET BINDINGS. A directory is invisible to every import gate.
  let bindingCount = 0;
  for (const path of paths) {
    if (!/(^|\/)wrangler[^/]*\.toml$/.test(path)) continue;
    const workspace = workspaceForPath(manifest, path);
    const { bindings, problems: parseProblems } = assetBindings(readFile(path));
    for (const problem of parseProblems) problems.push(`${path} ${problem}`);
    for (const binding of bindings) {
      bindingCount += 1;
      const target = normalise(`${dirname(path)}/${binding.value}`);
      const label = `${path} [${binding.table}] ${binding.key} = "${binding.value}"`;
      if (workspace && target !== workspace.root && !target.startsWith(`${workspace.root}/`)) {
        add(
          `asset-crosses-workspace::${path}::${binding.table}.${binding.key}`,
          `${label} deploys ${target}, which is outside ${workspace.root}`,
        );
      }
      const deployed = paths.filter(
        (candidate) => candidate === target || candidate.startsWith(`${target}/`),
      );
      if (deployed.length === 0) {
        add(
          `asset-unplaceable::${path}::${binding.table}.${binding.key}`,
          `${label} deploys ${target}, which holds no tracked file, so its visibility follows a build this gate cannot see`,
        );
        continue;
      }
      const counts = visibilityCounts(manifest, deployed);
      if (counts.size > 1) {
        add(
          `asset-mixed-visibility::${path}::${binding.table}.${binding.key}`,
          `${label} deploys ${deployed.length} tracked files of more than one visibility (${describeCounts(counts)}), so the split tears this binding apart`,
        );
      }
    }
  }

  findings.sort((left, right) => left.key.localeCompare(right.key));
  return {
    problems,
    findings,
    placed,
    scanned,
    bindingCount,
    trackedCount: paths.length,
    unmatchedPrivateRules,
    holdsPrivateHalf: holdsPrivate,
  };
}

export function checkOpenCoreBoundaries(repositoryRoot = REPO_ROOT) {
  const { manifest, problems } = loadOwnership(repositoryRoot);
  if (manifest === undefined) {
    return {
      problems,
      findings: [],
      placed: 0,
      scanned: 0,
      bindingCount: 0,
      trackedCount: 0,
      unmatchedPrivateRules: [],
      holdsPrivateHalf: true,
    };
  }
  const paths = trackedFiles(repositoryRoot);
  const readFile = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
  return analyzeOpenCoreBoundaries(
    manifest,
    paths,
    readFile,
    holdsPrivateHalf(manifest, repositoryRoot),
  );
}

export function formatReport(result, reconciliation, strict) {
  const lines = [
    `Open-core boundary check (${strict ? "strict" : "acceptance-reconciled"}). Ownership map: docs/reference/open-core-ownership.json.`,
    `Placed ${result.placed} of ${result.trackedCount} tracked files, read ${result.scanned} for import edges, and resolved ${result.bindingCount} wrangler asset bindings.`,
  ];
  for (const problem of result.problems) lines.push(`! ${problem}`);
  if (result.unmatchedPrivateRules?.length) {
    lines.push(
      `This tree holds the public half only, so ${result.unmatchedPrivateRules.length} rule(s) place files it does not carry: ${result.unmatchedPrivateRules.join(", ")}.`,
    );
  }
  lines.push("");
  lines.push(...formatAcceptanceSection(reconciliation, strict, result.holdsPrivateHalf !== false));
  return lines.join("\n");
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const strict = process.argv.includes("--strict");
  const rootArgument = process.argv.find((argument) =>
    argument.startsWith("--root="),
  );
  const repositoryRoot = rootArgument
    ? resolve(rootArgument.slice("--root=".length))
    : REPO_ROOT;
  const result = checkOpenCoreBoundaries(repositoryRoot);
  const acceptance = readAcceptance(repositoryRoot);
  const reconciliation = reconcile(result.findings, acceptance.entries, CHECK_ID);
  const problems = [...result.problems, ...acceptance.problems];
  console.log(formatReport({ ...result, problems }, reconciliation, strict));
  process.exitCode = exitCodeFor({
    problems,
    reconciliation,
    strict,
    staleFails: result.holdsPrivateHalf !== false,
  });
}
