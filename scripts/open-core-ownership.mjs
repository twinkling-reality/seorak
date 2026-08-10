/**
 * The open-core ownership map, loaded once for every gate that needs it.
 *
 * ADR 005 splits this repository into a public core and a private cloud. The
 * map of which is which lives in `docs/reference/open-core-ownership.json` and
 * NOWHERE ELSE: ADR 005's ownership section and CLAUDE.md's repo map point at
 * it rather than carrying a second copy. A duplicated allowlist does not fail
 * when it drifts, it silently stops protecting anything, so there is one copy
 * and a coverage rule that makes an omission loud.
 *
 * This module is data plumbing only. It does not decide anything; it reads the
 * manifest, compiles its path rules, and hands both gates the same answers:
 *
 *   - `classifyPath` gives a tracked path its visibility, most specific rule
 *     wins, and an exact tie between disagreeing rules is a hard error rather
 *     than a coin flip.
 *   - `publicFiles` answers "which tracked files land in the public
 *     repository", which is the question B2r collapsed a second module into.
 *     `scripts/public-file-set.mjs` used to answer it from its own inline
 *     rules, the two disagreed about 37 files, and neither gate failed. There
 *     is one answer now and `one-public-file-set.test.mjs` fails if a second
 *     appears.
 *   - `mayImport` reads the visibility table, so adding a visibility class is
 *     an edit to the manifest and to nothing else.
 *   - `boundaryPolicies` builds `check-package-boundaries.mjs`'s per-workspace
 *     policies from the same workspace list, which is what replaces the literal
 *     `@seorak/` prefix test: `seorak-app` is a workspace whose name does not
 *     carry the prefix, and it escaped that test.
 *
 * ACCEPTANCE, AND THE DEFECT THIS DELIBERATELY DOES NOT REPEAT. The sibling
 * types gate landed wired into `npm test` WITHOUT its enforcing flag, so a new
 * undeclared violation printed a line and CI stayed green. Here enforcement is
 * the default and the acceptance file is the only escape hatch: a finding it
 * carries exits zero, and ANYTHING ELSE fails. Report mode protects what an
 * owner has already seen, not what nobody has discovered yet. `--strict`
 * ignores the acceptance file entirely, which is how B1b checks its own work.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gitSync } from "./isolated-git.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OWNERSHIP_PATH = "docs/reference/open-core-ownership.json";
export const ACCEPTANCE_PATH = "docs/reference/open-core-boundary-acceptance.json";
export const OWNERSHIP_SCHEMA_VERSION = 2;
export const ACCEPTANCE_SCHEMA_VERSION = 1;

const SOURCE_MODES = new Set(["production", "development"]);
const MODULE_LOADER_MODES = new Set(["forbidden", "allowed"]);
const RULE_SOURCES = new Set([
  "adr-005",
  "b1a",
  "b2r",
  "b4",
  "b5",
  "b6",
  "b7",
  "c0",
  "c0b",
  "c1b",
  // C1g placed the git-isolation wrapper and its gate. It is a C1 sub-stage
  // rather than C3 or C4, which are real unstarted roadmap rows and would be a
  // false attribution; ROADMAP.md is the orchestrator's document, so the row
  // itself is reported rather than written from here.
  "c1g",
  "c2",
  // C2t placed the test-timeout policy gate. A sub-stage id for the same reason
  // c1g is one: C3 and C4 are real unstarted roadmap rows, and attributing a
  // gate to a row nobody has started would be false. ROADMAP.md is the
  // orchestrator's document, so the row itself is reported rather than written
  // from here.
  "c2t",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `**` spans any number of segments, `*` stays inside one. Nothing else is
 * supported on purpose: a pattern language a reader has to look up is a gate
 * people stop editing.
 */
function patternToRegExp(pattern) {
  const segments = pattern.split("/");
  const parts = [];
  for (const [index, segment] of segments.entries()) {
    if (segment === "**") {
      parts.push(index === segments.length - 1 ? "(?:.*)" : "(?:[^/]+/)*");
      continue;
    }
    const body = segment
      .split("*")
      .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*");
    parts.push(index === segments.length - 1 ? body : `${body}/`);
  }
  return new RegExp(`^${parts.join("")}$`);
}

/**
 * More literal segments beats fewer; a longer pattern beats a shorter one at
 * the same literal depth. Two matching rules that tie on both and disagree are
 * an authoring mistake, not something to resolve silently.
 */
function specificityOf(pattern) {
  const segments = pattern.split("/");
  const literals = segments.filter((segment) => !segment.includes("*")).length;
  return [literals, segments.length, pattern.length];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

function validateManifest(manifest, path) {
  const problems = [];
  const fail = (message) => problems.push(`${path} ${message}`);

  if (manifest?.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    fail("has an unsupported schema version");
    return problems;
  }
  const visibilities = manifest.visibilities;
  if (!visibilities || typeof visibilities !== "object" || Array.isArray(visibilities)) {
    fail("has no visibilities table");
    return problems;
  }
  const names = Object.keys(visibilities);
  if (names.length === 0) fail("declares no visibility classes");
  for (const [name, entry] of Object.entries(visibilities)) {
    if (typeof entry?.summary !== "string" || entry.summary.length === 0) {
      fail(`visibility ${name} has no summary`);
    }
    if (!Array.isArray(entry?.mayImport)) {
      fail(`visibility ${name} has no mayImport list`);
      continue;
    }
    for (const target of entry.mayImport) {
      if (!names.includes(target)) {
        fail(`visibility ${name} may import unknown visibility ${target}`);
      }
    }
  }

  if (!Array.isArray(manifest.paths) || manifest.paths.length === 0) {
    fail("has no paths rules");
  } else {
    for (const [index, rule] of manifest.paths.entries()) {
      if (typeof rule?.pattern !== "string" || rule.pattern.length === 0) {
        fail(`paths rule ${index} has no pattern`);
        continue;
      }
      if (!names.includes(rule.visibility)) {
        fail(`paths rule ${rule.pattern} has unknown visibility ${rule.visibility}`);
      }
      if (rule.visibility === "mixed") {
        fail(`paths rule ${rule.pattern} uses mixed, which only a workspace may carry`);
      }
      if (!RULE_SOURCES.has(rule.source)) {
        fail(`paths rule ${rule.pattern} must record source as one of ${[...RULE_SOURCES].join(", ")}`);
      }
      if (typeof rule.why !== "string" || rule.why.length === 0) {
        fail(`paths rule ${rule.pattern} has no why`);
      }
      // A rule may declare that its files land in the public repository under a
      // DIFFERENT path. One does: the public halves of the root manifests,
      // which cannot be divided in place because both halves must be called
      // package.json and sit at the root. It is data rather than a special case
      // in a gate, because the gate that needs it is the one asking why a rule
      // matches nothing in a tree assembled from this map.
      if (rule.relocatedTo !== undefined && typeof rule.relocatedTo !== "string") {
        fail(`paths rule ${rule.pattern} has a relocatedTo that is not a string`);
      }
      if (rule.condition !== undefined && typeof rule.conditionOwner !== "string") {
        fail(`paths rule ${rule.pattern} states a condition with no conditionOwner`);
      }
      // A condition is an acceptance: it says a placement stands while a named
      // stage still owes an answer. Without a date it is renewed by nobody and
      // reviewed by nobody, which is how a provisional placement becomes a
      // claim the repository forgot it made.
      if (rule.condition !== undefined && !ISO_DATE.test(rule.conditionAcceptedOn ?? "")) {
        fail(`paths rule ${rule.pattern} states a condition with no conditionAcceptedOn date`);
      }
    }
    const seen = new Set();
    for (const rule of manifest.paths) {
      if (typeof rule?.pattern !== "string") continue;
      if (seen.has(rule.pattern)) fail(`paths rule ${rule.pattern} is declared twice`);
      seen.add(rule.pattern);
    }
  }

  if (!Array.isArray(manifest.workspaces) || manifest.workspaces.length === 0) {
    fail("has no workspaces");
  } else {
    for (const workspace of manifest.workspaces) {
      const label = workspace?.root ?? "<unnamed>";
      if (typeof workspace?.root !== "string" || workspace.root.length === 0) {
        fail("a workspace has no root");
        continue;
      }
      if (!names.includes(workspace.visibility)) {
        fail(`workspace ${label} has unknown visibility ${workspace.visibility}`);
      }
      if (typeof workspace.why !== "string" || workspace.why.length === 0) {
        fail(`workspace ${label} has no why`);
      }
      if (workspace.package === null) continue;
      if (typeof workspace.package !== "string" || workspace.package.length === 0) {
        fail(`workspace ${label} has no package name and is not declared manifest-free`);
        continue;
      }
      if (!Array.isArray(workspace.sourceRoots) || workspace.sourceRoots.length === 0) {
        fail(`workspace ${label} declares no source roots`);
      } else {
        for (const sourceRoot of workspace.sourceRoots) {
          if (typeof sourceRoot?.path !== "string" || !SOURCE_MODES.has(sourceRoot?.mode)) {
            fail(`workspace ${label} has an invalid source root`);
          }
        }
      }
      if (!Array.isArray(workspace.allowedInternalPackages)) {
        fail(`workspace ${label} has no allowedInternalPackages list`);
      }
      if (!MODULE_LOADER_MODES.has(workspace.moduleLoaders)) {
        fail(`workspace ${label} must set moduleLoaders to one of ${[...MODULE_LOADER_MODES].join(", ")}`);
      }
    }
  }

  // THE PUBLIC FILE SET. One block, because one question. `visibilities` says
  // which classes land in the public repository and `redactionPending` says
  // which of those files a CONTENT scan may not judge yet.
  const fileSet = manifest.publicFileSet;
  if (!fileSet || typeof fileSet !== "object" || Array.isArray(fileSet)) {
    fail("has no publicFileSet block");
  } else {
    if (!Array.isArray(fileSet.visibilities) || fileSet.visibilities.length === 0) {
      fail("publicFileSet declares no visibilities");
    } else {
      for (const visibility of fileSet.visibilities) {
        if (!names.includes(visibility)) {
          fail(`publicFileSet names unknown visibility ${visibility}`);
        }
        // `mixed` is a workspace identity, never a file's, so a file set built
        // from it would be a set no path can be in.
        if (visibility === "mixed") {
          fail("publicFileSet names mixed, which only a workspace may carry");
        }
      }
    }
    if (!Array.isArray(fileSet.redactionPending)) {
      fail("publicFileSet has no redactionPending list");
    } else {
      for (const entry of fileSet.redactionPending) {
        if (
          typeof entry?.pattern !== "string" ||
          typeof entry?.why !== "string" ||
          typeof entry?.owner !== "string"
        ) {
          fail("a redactionPending entry needs a pattern, a why, and an owner");
        }
      }
    }
  }

  const coverage = manifest.coverage;
  if (!Array.isArray(coverage?.roots) || !Array.isArray(coverage?.rootFiles)) {
    fail("has no coverage roots");
  }
  for (const entry of coverage?.outOfScope ?? []) {
    if (typeof entry?.path !== "string" || typeof entry?.why !== "string" || typeof entry?.owner !== "string") {
      fail("an outOfScope entry needs a path, a why, and an owner");
    }
  }
  if (!Array.isArray(manifest.developmentFilePatterns)) {
    fail("has no developmentFilePatterns list");
  }
  return problems;
}

export function loadOwnership(repositoryRoot = REPO_ROOT, path = OWNERSHIP_PATH) {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) {
    return { manifest: undefined, problems: [`${path} is missing`] };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return { manifest: undefined, problems: [`${path} is not valid JSON`] };
  }
  const problems = validateManifest(manifest, path);
  if (problems.length > 0) return { manifest: undefined, problems };
  return { manifest: compile(manifest), problems: [] };
}

function compile(manifest) {
  const rules = manifest.paths.map((rule) => ({
    ...rule,
    matcher: patternToRegExp(rule.pattern),
    specificity: specificityOf(rule.pattern),
  }));
  const developmentMatchers = manifest.developmentFilePatterns.map(patternToRegExp);
  const outOfScope = (manifest.coverage.outOfScope ?? []).map((entry) => ({
    ...entry,
    matcher: patternToRegExp(entry.path),
  }));
  const redactionPending = manifest.publicFileSet.redactionPending.map((entry) => ({
    ...entry,
    matcher: patternToRegExp(entry.pattern),
  }));
  return { ...manifest, rules, developmentMatchers, outOfScope, redactionPending };
}

/**
 * The visibility of one repository-relative path, plus the rule that decided
 * it. `undefined` means no rule matched, which the coverage check reports as a
 * placement nobody has made.
 */
export function classifyPath(manifest, path) {
  let best;
  let tied = [];
  for (const rule of manifest.rules) {
    if (!rule.matcher.test(path)) continue;
    if (best === undefined) {
      best = rule;
      tied = [rule];
      continue;
    }
    const order = compareSpecificity(rule.specificity, best.specificity);
    if (order < 0) {
      best = rule;
      tied = [rule];
    } else if (order === 0) {
      tied.push(rule);
    }
  }
  if (best === undefined) return undefined;
  const disagreeing = tied.filter((rule) => rule.visibility !== best.visibility);
  if (disagreeing.length > 0) {
    return {
      visibility: best.visibility,
      rule: best,
      ambiguousWith: disagreeing.map((rule) => rule.pattern),
    };
  }
  return { visibility: best.visibility, rule: best };
}

export function isOutOfScope(manifest, path) {
  return manifest.outOfScope.find((entry) => entry.matcher.test(path));
}

export function isCovered(manifest, path) {
  if (manifest.coverage.rootFiles.includes(path)) return true;
  const root = path.split("/")[0];
  return manifest.coverage.roots.includes(root);
}

export function isDevelopmentFile(manifest, path) {
  return manifest.developmentMatchers.some((matcher) => matcher.test(path));
}

/**
 * Is this path in the public file set: does it land in the public repository?
 *
 * A path no rule places is NOT in it. The default for an unclassified file has
 * to be the safe one, and the coverage check is what stops that default from
 * being how files get placed.
 */
export function isPublicFile(manifest, path) {
  const placement = classifyPath(manifest, path);
  if (placement === undefined) return false;
  return manifest.publicFileSet.visibilities.includes(placement.visibility);
}

/**
 * The entry declaring that this file goes public REDACTED, if there is one.
 *
 * It is IN the public file set and its content is not judgeable yet. Dropping
 * it from the set instead would be a lie about where it goes; ADR 005 itself
 * quotes the operator's subdomain as the evidence for removing it, so a content
 * scan over these would fail on its own justification.
 */
export function redactionPendingFor(manifest, path) {
  return manifest.redactionPending.find((entry) => entry.matcher.test(path));
}

/** Every tracked file the ownership map sends to the public core, sorted. */
export function publicFiles(manifest, repositoryRoot = REPO_ROOT) {
  return trackedFiles(repositoryRoot).filter((path) => isPublicFile(manifest, path));
}

/**
 * Does this tree hold BOTH halves of the split, or only the public one?
 *
 * WHY ANY GATE NEEDS TO ASK. These gates ship in the public repository, which
 * by construction holds no private file: `packages/worker/**` and
 * `apps/mobile/**` match nothing, and the acceptance file's entries describe
 * findings the tree cannot produce. Read as "the private half was deleted",
 * every one of those is a failure; read as "this is the public half", none of
 * them is. Nothing in the tree says which, so this asks the map: a tree that
 * holds a file the map does not send public is the repository that owns both
 * halves.
 *
 * It is deliberately a property of the TREE rather than a flag, because a flag
 * is something CI can forget to pass and a stranger cannot know to.
 *
 * ENFORCEMENT IS THE DEFAULT WHEN THE ANSWER IS UNKNOWN: with no map there is
 * nothing to be lenient on behalf of, and a gate that goes quiet when its map
 * fails to load is worse than one that fails.
 */
export function holdsPrivateHalf(manifest, repositoryRoot = REPO_ROOT) {
  if (manifest === undefined) return true;
  return trackedFiles(repositoryRoot).some((path) => !isPublicFile(manifest, path));
}

/**
 * Is a path's ABSENCE from this tree expected rather than a finding? True only
 * for a path the map keeps private, in a tree that holds only the public half.
 * A public file that has gone missing is a finding in either repository.
 */
export function absenceIsExpected(manifest, path, holdsPrivate) {
  return !holdsPrivate && !isPublicFile(manifest, path);
}

export function mayImport(manifest, from, to) {
  return manifest.visibilities[from]?.mayImport.includes(to) ?? false;
}

export function workspaceForPath(manifest, path) {
  let found;
  for (const workspace of manifest.workspaces) {
    if (path !== workspace.root && !path.startsWith(`${workspace.root}/`)) continue;
    if (found === undefined || workspace.root.length > found.root.length) found = workspace;
  }
  return found;
}

export function workspaceByPackage(manifest, packageName) {
  return manifest.workspaces.find((workspace) => workspace.package === packageName);
}

/**
 * The per-workspace policies `check-package-boundaries.mjs` enforces. Every
 * field comes from the manifest, so adding a tenth workspace is a data edit.
 */
export function boundaryPolicies(manifest) {
  return manifest.workspaces
    .filter((workspace) => workspace.package !== null)
    .map((workspace) => ({
      packageRoot: workspace.root,
      packageName: workspace.package,
      visibility: workspace.visibility,
      sourceRoots: workspace.sourceRoots,
      allowedInternalPackages: new Set(workspace.allowedInternalPackages),
      moduleLoaders: workspace.moduleLoaders,
      developmentMatchers: manifest.developmentMatchers,
      workspacePackages: new Map(
        manifest.workspaces
          .filter((entry) => entry.package !== null)
          .map((entry) => [entry.package, entry.visibility]),
      ),
      visibilities: manifest.visibilities,
    }));
}

/**
 * Every file git would carry: tracked, plus untracked files no ignore rule
 * excludes. A new file is in the tree the moment it exists, not the moment it
 * is staged, so a placement it lacks is a gap NOW. Ignore rules stay the only
 * copy of what is not source, exactly as `check-source-bytes.mjs` treats them.
 */
export function trackedFiles(repositoryRoot = REPO_ROOT) {
  const output = gitSync(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return [...new Set(output.split("\0").filter((path) => path.length > 0))].sort();
}

const ACCEPTANCE_FIELDS = ["check", "key", "acceptedOn", "why", "falsifiedWhen"];
const ACCEPTED_ON = /^\d{4}-\d{2}-\d{2}$/;

export function readAcceptance(repositoryRoot = REPO_ROOT, path = ACCEPTANCE_PATH) {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) {
    return { entries: [], problems: [`${path} is missing`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return { entries: [], problems: [`${path} is not valid JSON`] };
  }
  if (parsed?.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) {
    return { entries: [], problems: [`${path} has an unsupported schema version`] };
  }
  if (!Array.isArray(parsed.entries)) {
    return { entries: [], problems: [`${path} has no entries array`] };
  }
  const problems = [];
  const entries = [];
  const seen = new Set();
  for (const [index, entry] of parsed.entries.entries()) {
    const missing = ACCEPTANCE_FIELDS.filter(
      (field) => typeof entry?.[field] !== "string" || entry[field].length === 0,
    );
    if (missing.length > 0) {
      problems.push(`${path} entry ${index} is missing ${missing.join(", ")}`);
      continue;
    }
    // A date and a falsification condition are what stop an entry becoming
    // permanent by accident. An entry that says only "accepted" is renewed by
    // nobody and reviewed by nobody.
    if (!ACCEPTED_ON.test(entry.acceptedOn)) {
      problems.push(`${path} entry ${index} has a malformed acceptedOn`);
      continue;
    }
    const identity = `${entry.check}::${entry.key}`;
    if (seen.has(identity)) {
      problems.push(`${path} entry ${index} duplicates ${identity}`);
      continue;
    }
    seen.add(identity);
    entries.push(entry);
  }
  return { entries, problems };
}

/**
 * Split findings into the ones an owner has already accepted and the ones
 * nobody has seen. `stale` is an acceptance entry whose finding is gone: the
 * entry is itself falsified and must be removed, which is what keeps the file
 * from outliving the thing it excuses.
 */
export function reconcile(findings, entries, check) {
  const scoped = entries.filter((entry) => entry.check === check);
  const byKey = new Map(scoped.map((entry) => [entry.key, entry]));
  const seen = new Set();
  const accepted = [];
  const undeclared = [];
  for (const finding of findings) {
    const entry = byKey.get(finding.key);
    if (entry) {
      seen.add(finding.key);
      accepted.push({ ...finding, acceptance: entry });
    } else {
      undeclared.push(finding);
    }
  }
  const stale = scoped.filter((entry) => !seen.has(entry.key));
  return { accepted, undeclared, stale };
}

/**
 * One exit rule for every gate that reads the acceptance file: undeclared
 * findings fail, stale entries fail, a malformed manifest or acceptance file
 * fails, and `--strict` fails on accepted findings too.
 */
export function exitCodeFor({ problems, reconciliation, strict, staleFails = true }) {
  if (problems.length > 0) return 1;
  if (reconciliation.undeclared.length > 0) return 1;
  if (staleFails && reconciliation.stale.length > 0) return 1;
  if (strict && reconciliation.accepted.length > 0) return 1;
  return 0;
}

/**
 * `staleFails` is false only in a tree that holds one half of the split. Every
 * accepted violation there names a file the tree does not have, so "this entry
 * no longer describes the tree" is true and means nothing: staleness is only
 * knowable where the whole tree is. The entries are still printed, under a
 * heading that says they were not evaluated rather than that they are dead.
 */
export function formatAcceptanceSection(reconciliation, strict, staleFails = true) {
  const lines = [];
  const { accepted, undeclared, stale } = reconciliation;
  lines.push(`Accepted violations (${accepted.length}):`);
  for (const finding of accepted) {
    lines.push(`  - ${finding.key}`);
    lines.push(`      ${finding.detail}`);
    lines.push(
      `      accepted ${finding.acceptance.acceptedOn}${
        finding.acceptance.owner ? ` (${finding.acceptance.owner})` : ""
      }; falsified when ${finding.acceptance.falsifiedWhen}`,
    );
  }
  lines.push("");
  lines.push(`Undeclared violations (${undeclared.length}):`);
  for (const finding of undeclared) {
    lines.push(`  - ${finding.key}`);
    lines.push(`      ${finding.detail}`);
  }
  if (stale.length > 0) {
    lines.push("");
    lines.push(
      staleFails
        ? `Acceptance entries with no matching violation (${stale.length}):`
        : `Acceptance entries not evaluated in this tree (${stale.length}), which holds one half of the split:`,
    );
    for (const entry of stale) {
      lines.push(
        staleFails
          ? `  - ${entry.key} is falsified, remove it`
          : `  - ${entry.key}`,
      );
    }
  }
  lines.push("");
  lines.push(
    strict
      ? "Strict: every violation fails, accepted or not."
      : "Accepted violations exit zero. Anything undeclared, and any acceptance entry that no longer matches, fails.",
  );
  return lines;
}
