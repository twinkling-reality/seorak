#!/usr/bin/env node --test

/**
 * ONE PUBLIC FILE SET. This is the property B2r exists for, not the deletion.
 *
 * B1a and B2 landed in parallel and each built its own answer to "which files
 * are public": `docs/reference/open-core-ownership.json` behind
 * `scripts/open-core-ownership.mjs`, and `scripts/public-file-set.mjs` with its
 * rules inline. Both gates passed. By `b5fc317` the two answers disagreed about
 * 37 tracked files and nothing went red, because a duplicated allowlist does
 * not fail when it drifts, it silently stops protecting anything. B2r collapsed
 * them; without this test it gets to happen a third time, and the third time
 * looks exactly as green as the second did.
 *
 * So this file fails when:
 *
 *   1. more than one module under `scripts/` exports the file-set API, which
 *      also catches a thin re-export, because a shim is a second definition
 *      with extra steps and the next reader cannot tell which is authoritative;
 *   2. a module uses the file set without importing it from the one loader;
 *   3. a gate carries a path-to-visibility rule of its own, or a second data
 *      file declares placements beside the manifest.
 *
 * EVERY DETECTOR READS CODE, NOT TEXT. They parse with the same TypeScript
 * front end `check-package-boundaries.mjs` uses, so a placement quoted inside a
 * string or a comment is not a placement, and this file can hold the planted
 * fixtures below without reporting itself. A grep would have to choose between
 * missing a real rule and failing on a sentence about one.
 *
 * Each detector is exercised against a PLANTED second definition, because a
 * detector that has only ever seen a clean tree proves nothing.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { loadOwnership } from "./open-core-ownership.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS, "..");
const REFERENCE = resolve(REPO_ROOT, "docs/reference");

/** The one module allowed to answer the question, and the one file it reads. */
const DEFINITION = "open-core-ownership.mjs";
const MANIFEST = "open-core-ownership.json";

/**
 * The names that MEAN "this module answers which files are public". A second
 * definition has to expose at least one of them to be usable by a gate, and a
 * re-export of one is still an export of it.
 */
export const FILE_SET_EXPORTS = Object.freeze([
  "isPublicFile",
  "isPublicPath",
  "publicFiles",
  "publicFilePaths",
  "publicFileSet",
  "redactionPendingFor",
  "PUBLIC_FILE_SET_RULES",
  "DOCUMENTATION_PENDING_REDACTION",
]);

const VISIBILITY_CLASSES = new Set([
  "public",
  "private",
  "split",
  "mixed",
  "excluded",
]);

function parse(source, path = "module.mjs") {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * Names a module exports. Declaration form and list form both count, and an
 * `as` alias is the exported name, since that is what an importer binds.
 */
export function exportedNames(source, path) {
  const names = new Set();
  walk(parse(source, path), (node) => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) names.add(element.name.text);
      return;
    }
    const exported = ts
      .getModifiers?.(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) return;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
      return;
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.add(node.name.text);
    }
  });
  return names;
}

/** File-set names this module actually references as code. */
export function usedFileSetNames(source, path) {
  const used = new Set();
  walk(parse(source, path), (node) => {
    if (ts.isIdentifier(node) && FILE_SET_EXPORTS.includes(node.text)) used.add(node.text);
  });
  return used;
}

export function importsTheDefinition(source, path) {
  let found = false;
  walk(parse(source, path), (node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
    const specifier = node.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier) && specifier.text === `./${DEFINITION}`) {
      found = true;
    }
  });
  return found;
}

/**
 * A path-to-visibility rule written in code rather than in the manifest. This
 * is the shape both dead definitions had: a literal placement beside a literal
 * visibility. `visibility: workspace.visibility` reads the manifest and is not
 * one; `visibility: "public"` and `public: true` are.
 *
 * A fixture manifest in a test is an INPUT to the one loader rather than a
 * second answer, so tests are exempt and gates are not.
 */
export function inlineRuleSites(source, path) {
  const sites = [];
  walk(parse(source, path), (node) => {
    if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)) return;
    const key = node.name.text;
    const value = node.initializer;
    const namesAClass = ts.isStringLiteral(value) && VISIBILITY_CLASSES.has(value.text);
    const isBoolean =
      value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
    if ((key === "visibility" && namesAClass) || (key === "public" && isBoolean)) {
      sites.push(`${key} at line ${parse(source, path).getLineAndCharacterOfPosition(node.pos).line + 1}`);
    }
  });
  return sites;
}

/** Does this JSON document declare a placement anywhere inside it? */
export function declaresPlacements(value) {
  if (Array.isArray(value)) return value.some(declaresPlacements);
  if (value === null || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "visibility" || key === "publicFileSet") return true;
    if (declaresPlacements(nested)) return true;
  }
  return false;
}

/** Every `.mjs` under `scripts/`, tests included. */
function scriptModules() {
  return readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
}

function sourceOf(name) {
  return readFileSync(resolve(SCRIPTS, name), "utf8");
}

test("exactly one module under scripts computes the public file set", () => {
  const definers = scriptModules().filter((name) => {
    const exported = exportedNames(sourceOf(name), name);
    return FILE_SET_EXPORTS.some((symbol) => exported.has(symbol));
  });

  assert.deepEqual(
    definers,
    [DEFINITION],
    "the public file set has more than one definition again; fold the new one into " +
      `docs/reference/${MANIFEST} rather than leaving a shim`,
  );
});

test("a module that uses the file set imports it, and never redefines it", () => {
  for (const name of scriptModules()) {
    if (name === DEFINITION) continue;
    const source = sourceOf(name);
    const used = usedFileSetNames(source, name);
    if (used.size === 0) continue;
    assert.ok(
      importsTheDefinition(source, name),
      `scripts/${name} uses ${[...used].join(", ")} without importing ./${DEFINITION}`,
    );
  }
});

test("no gate carries placement rules, and no second data file declares them", () => {
  for (const name of scriptModules()) {
    if (name === DEFINITION || name.endsWith(".test.mjs")) continue;
    const sites = inlineRuleSites(sourceOf(name), name);
    assert.deepEqual(
      sites,
      [],
      `scripts/${name} declares a path visibility in code; placements live in the manifest`,
    );
  }

  for (const name of readdirSync(REFERENCE).filter((entry) => entry.endsWith(".json"))) {
    if (name === MANIFEST) continue;
    const document = JSON.parse(readFileSync(resolve(REFERENCE, name), "utf8"));
    assert.equal(
      declaresPlacements(document),
      false,
      `docs/reference/${name} declares placements; the map is docs/reference/${MANIFEST}`,
    );
  }
});

test("the manifest is the thing that carries the answer, and it carries all of it", () => {
  const { manifest, problems } = loadOwnership(REPO_ROOT);
  assert.deepEqual(problems, []);

  // Both halves of what the deleted module held: which classes are in the set,
  // and which files are in it but not content-scannable yet. If either moves
  // back into code the tests above fail; if either is missing here, the
  // question has no answer at all.
  assert.ok(manifest.publicFileSet.visibilities.length > 0);
  assert.ok(Array.isArray(manifest.publicFileSet.redactionPending));
  for (const entry of manifest.publicFileSet.redactionPending) {
    assert.ok(entry.owner.length > 0, `${entry.pattern} names no owner`);
  }
});

test("each detector fails on a planted second definition", () => {
  // A fresh module with its rules inline: what `public-file-set.mjs` was.
  const planted = [
    'export const RULES = [{ prefix: "packages/web/src/", public: true }];',
    "export function isPublicPath(path) { return path.startsWith(RULES[0].prefix); }",
  ].join("\n");
  assert.ok(exportedNames(planted).has("isPublicPath"));
  assert.equal(inlineRuleSites(planted).length, 1);
  assert.ok(usedFileSetNames(planted).has("isPublicPath"));
  assert.equal(importsTheDefinition(planted), false);

  // A thin re-export, which is the tempting version and the worse one: it
  // leaves two module names answering one question.
  assert.ok(
    exportedNames('export { publicFiles } from "./open-core-ownership.mjs";').has("publicFiles"),
  );
  assert.ok(
    exportedNames(
      'export { publicFiles as isPublicPath } from "./open-core-ownership.mjs";',
    ).has("isPublicPath"),
  );

  // A second manifest beside the real one.
  assert.equal(declaresPlacements({ paths: [{ pattern: "packages/**", visibility: "public" }] }), true);
  assert.equal(declaresPlacements({ schemaVersion: 1, entries: [{ check: "x", key: "y" }] }), false);

  // The clean shapes stay clean, or the detectors are noise and get switched
  // off: an ordinary consumer, and a visibility read from data rather than
  // written down.
  const consumer = 'import { publicFiles } from "./open-core-ownership.mjs";\npublicFiles(map, root);';
  assert.ok(usedFileSetNames(consumer).has("publicFiles"));
  assert.ok(importsTheDefinition(consumer));
  assert.deepEqual(inlineRuleSites(consumer), []);
  assert.deepEqual(
    inlineRuleSites("const policy = { visibility: workspace.visibility };"),
    [],
  );
  // A sentence about a placement is not a placement, which is why these read
  // code rather than text.
  assert.deepEqual(inlineRuleSites('const note = "visibility: \\"public\\"";'), []);
  assert.deepEqual(exportedNames('const note = "export { publicFiles }";').size, 0);
});
