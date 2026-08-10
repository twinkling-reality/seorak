#!/usr/bin/env node

/**
 * The vendored-asset gate: is every third-party file in the tree still the file
 * its provenance record says it is?
 *
 * `packages/web/THIRD_PARTY_NOTICES.md` has recorded "Simple Icons v15.0.0,
 * vendored 2026-07-06" since the icons landed, and until this gate existed
 * NOTHING VERIFIED IT. `simple-icons` is not a dependency in any manifest; the
 * files were fetched by a script and committed, so the recorded version was a
 * claim about one afternoon rather than a fact about the tree. A file could be
 * edited, replaced, or added and the notices file would go on reading as
 * current state forever. That is the same failure mode B7 found in the thirteen
 * AI-tool marks, where the recorded provenance turned out to be wrong for nine
 * of thirteen files and nothing had ever said so.
 *
 * A version recorded with no way to check it is not a pin. This makes it one.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 * ---------------------------------------------------------------------------
 *
 * DECLARATION. Every tracked file under a declared root belongs to exactly one
 * collection or is listed as original work. An undeclared file is a hard
 * failure, for the same reason an unplaced file fails the ownership gate:
 * vendoring something is a decision somebody made, and it should not be
 * possible to make it by copying a file into a directory.
 *
 * DIGEST. Each collection records a digest over its sorted `path + content-hash`
 * pairs. Editing a vendored file, adding one, or removing one all change it, so
 * the recorded version stops being a claim and becomes a checkable statement
 * about these exact bytes. This is offline and needs no network.
 *
 * THE NOTICES FILE AGREES. The human-readable notice must carry the same version
 * and sync date the machine-readable record does. Two copies of one fact drift;
 * this makes them fail instead.
 *
 * ---------------------------------------------------------------------------
 * THE LIMIT, STATED RATHER THAN IMPLIED
 * ---------------------------------------------------------------------------
 *
 * A digest proves the vendored bytes are the ones recorded on
 * `verifiedAgainstUpstreamOn`. It does NOT re-fetch upstream, so it cannot prove
 * on its own that those bytes still match the named upstream version. That
 * requires a network and the collection's own `resync` command. What the digest
 * buys is the property that actually rots: nobody can change a vendored file, or
 * add one, without this going red.
 *
 * Fonts are deliberately not covered. `packages/web/public/fonts` holds licensed
 * binaries the ownership map already marks `excluded`, and their disposition is
 * ADR 005 decision 6's, owned by stage B5. Declaring them here would be a second
 * answer to a question that already has one.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  REPO_ROOT,
  absenceIsExpected,
  holdsPrivateHalf,
  loadOwnership,
  trackedFiles,
} from "./open-core-ownership.mjs";

export const MANIFEST_PATH = "docs/reference/vendored-assets.json";
export const MANIFEST_SCHEMA_VERSION = 1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_COLLECTION_FIELDS = [
  "id",
  "root",
  "upstream",
  "version",
  "license",
  "syncedOn",
  "verifiedAgainstUpstreamOn",
  "resync",
  "notices",
];

/** sha256 of one file's bytes, hex. */
export function hashFile(repositoryRoot, path) {
  return createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex");
}

/** Field separator inside the digest, written as an escape: a raw control byte
 *  in a source file is what `check-source-bytes.mjs` exists to refuse. */
const FIELD = "\u0000";

/**
 * A collection's digest: sha256 over `path` and each file's content hash, in
 * sorted path order. Path is included so a rename is a change, and the sort
 * makes it independent of how the file list was produced.
 */
export function digestOf(repositoryRoot, paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path);
    hash.update(FIELD);
    hash.update(hashFile(repositoryRoot, path));
    hash.update(FIELD);
  }
  return `sha256:${hash.digest("hex")}`;
}

function underRoot(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

export function loadManifest(repositoryRoot = REPO_ROOT, path = MANIFEST_PATH) {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) return { manifest: undefined, problems: [`${path} is missing`] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return { manifest: undefined, problems: [`${path} is not valid JSON`] };
  }
  const problems = [];
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return { manifest: undefined, problems: [`${path} has an unsupported schema version`] };
  }
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0) {
    problems.push(`${path} declares no roots`);
  }
  if (!Array.isArray(manifest.collections)) problems.push(`${path} has no collections array`);
  if (!Array.isArray(manifest.original)) problems.push(`${path} has no original array`);
  for (const collection of manifest.collections ?? []) {
    const label = collection?.id ?? "<unnamed>";
    for (const field of REQUIRED_COLLECTION_FIELDS) {
      if (typeof collection?.[field] !== "string" || collection[field].length === 0) {
        problems.push(`${path} collection ${label} is missing ${field}`);
      }
    }
    for (const field of ["syncedOn", "verifiedAgainstUpstreamOn"]) {
      if (collection?.[field] !== undefined && !ISO_DATE.test(collection[field])) {
        problems.push(`${path} collection ${label} has a malformed ${field}`);
      }
    }
    if (typeof collection?.digest !== "string" || !collection.digest.startsWith("sha256:")) {
      problems.push(`${path} collection ${label} has no sha256 digest`);
    }
    if (!Number.isInteger(collection?.fileCount)) {
      problems.push(`${path} collection ${label} declares no integer fileCount`);
    }
  }
  for (const entry of manifest.original ?? []) {
    if (typeof entry?.path !== "string" || typeof entry?.why !== "string") {
      problems.push(`${path} has an original entry with no path and why`);
    }
  }
  if (problems.length > 0) return { manifest: undefined, problems };
  return { manifest, problems: [] };
}

/**
 * @param absenceExpected a path whose absence this tree is EXPECTED to have,
 * because the ownership map keeps it private and this tree is the public half.
 * Defaults to nothing being expected-absent, which is the repository that owns
 * both halves and the only place a record can be reconciled in full.
 */
export function analyzeVendoredAssets(
  manifest,
  paths,
  repositoryRoot,
  readFile,
  absenceExpected = () => false,
) {
  const problems = [];
  const notes = [];
  const covered = paths.filter((path) => manifest.roots.some((root) => underRoot(path, root)));
  const originals = new Set(manifest.original.map((entry) => entry.path));

  for (const entry of manifest.original) {
    if (paths.includes(entry.path)) continue;
    if (absenceExpected(entry.path)) {
      notes.push(`${entry.path}: declared original work, not in this tree, private in the ownership map.`);
      continue;
    }
    problems.push(
      `${entry.path} is declared original work and is not in the tree; a record that outlives its file stops being a record`,
    );
  }

  for (const collection of manifest.collections) {
    const files = covered.filter((path) => underRoot(path, collection.root));
    if (files.length === 0) {
      if (absenceExpected(collection.root)) {
        notes.push(
          `${collection.id}: ${collection.root} is not in this tree, and the ownership map keeps it private, so its ${collection.fileCount} files are not measurable here.`,
        );
        continue;
      }
      problems.push(`collection ${collection.id} covers ${collection.root}, which holds no tracked file`);
      continue;
    }
    // The count is checked first and on its own. An added or deleted file
    // changes the digest too, but "the digest moved" is the wrong sentence for
    // it: the author needs to be told a file appeared, not that the bytes of
    // some unnamed icon differ from a hash. A count mismatch therefore reports
    // and skips the digest, which would otherwise restate the same fact worse.
    if (files.length !== collection.fileCount) {
      problems.push(
        `collection ${collection.id} declares ${collection.fileCount} files and ${collection.root} holds ${files.length}. Re-verify with \`${collection.resync}\` and update ${MANIFEST_PATH}, or revert the change`,
      );
    } else {
      const digest = digestOf(repositoryRoot, files);
      if (digest !== collection.digest) {
        problems.push(
          `collection ${collection.id} does not match its recorded digest. The tree is not what ${collection.upstream} ${collection.version} was recorded as on ${collection.verifiedAgainstUpstreamOn}. Re-verify with \`${collection.resync}\` and update ${MANIFEST_PATH}, or revert the change`,
        );
      } else {
        notes.push(
          `${collection.id}: ${files.length} files, ${collection.upstream.replace(/^https:\/\/github\.com\//, "")} ${collection.version}, ${collection.license}, verified against upstream ${collection.verifiedAgainstUpstreamOn}.`,
        );
      }
    }

    // THE NOTICES FILE AGREES.
    const notices = readFile(collection.notices);
    if (notices === undefined) {
      problems.push(`collection ${collection.id} names ${collection.notices}, which does not exist`);
      continue;
    }
    for (const [field, value] of [
      ["version", collection.version],
      ["syncedOn", collection.syncedOn],
    ]) {
      if (!notices.includes(value)) {
        problems.push(
          `${collection.notices} does not record ${collection.id}'s ${field} (${value}); the human-readable notice and ${MANIFEST_PATH} must not drift`,
        );
      }
    }
  }

  // DECLARATION.
  for (const path of covered) {
    if (originals.has(path)) continue;
    if (manifest.collections.some((collection) => underRoot(path, collection.root))) continue;
    problems.push(
      `${path} is under a vendored-asset root and is declared nowhere. Add it to ${MANIFEST_PATH}: a collection entry if it comes from upstream, an original entry if this repository drew it. Vendoring is a decision, not a copy`,
    );
  }

  return { problems, notes, covered: covered.length };
}

export function checkVendoredAssets(repositoryRoot = REPO_ROOT) {
  const { manifest, problems } = loadManifest(repositoryRoot);
  if (manifest === undefined) return { problems, notes: [], covered: 0 };
  const readFile = (path) => {
    const absolute = resolve(repositoryRoot, path);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  };
  // Two of the three collections and all five brand originals are private, so
  // in the public repository this record describes files that are absent by
  // construction. The ownership map is what tells the difference between that
  // and a record whose file was deleted.
  const { manifest: ownership } = loadOwnership(repositoryRoot);
  const holdsPrivate = holdsPrivateHalf(ownership, repositoryRoot);
  const absenceExpected = (path) =>
    ownership !== undefined && absenceIsExpected(ownership, path, holdsPrivate);
  return analyzeVendoredAssets(
    manifest,
    trackedFiles(repositoryRoot),
    repositoryRoot,
    readFile,
    absenceExpected,
  );
}

export function formatReport({ problems, notes, covered }) {
  const lines = [`Vendored-asset check. Provenance record: ${MANIFEST_PATH}.`, `Declared ${covered} tracked files under the vendored-asset roots.`];
  for (const note of notes) lines.push(`  ${note}`);
  if (problems.length === 0) {
    lines.push("", "No problems.");
    return lines.join("\n");
  }
  lines.push("", `Problems (${problems.length}):`);
  for (const problem of problems) lines.push(`  ! ${problem}`);
  return lines.join("\n");
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const repositoryRoot = rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT;
  const result = checkVendoredAssets(repositoryRoot);
  console.log(formatReport(result));
  process.exitCode = result.problems.length > 0 ? 1 : 0;
}
