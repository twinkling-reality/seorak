#!/usr/bin/env node

/**
 * CLAUDE.md rule 2, made testable.
 *
 * The rule: `@seorak/types` is publish-safe only, with no scoring, evaluation, or
 * extraction implementation. `docs/ARCHITECTURE.md` authorises the public wire
 * catalogs, the default thresholds, and the vendor list prices, because every
 * consumer needs the identical contract.
 *
 * THIS FILE IS THE ONLY OPERATIONAL DEFINITION. Neither CLAUDE.md nor
 * ARCHITECTURE.md restates it, and this script restates neither of them: it
 * names no symbol, no file, and no authorised category. It classifies by code
 * shape alone, so the authorisation in ARCHITECTURE.md is satisfied by
 * construction rather than by a second copy of the list. A catalog, a threshold
 * default, and a price table are data declarations, and data declarations are
 * not the subject of any rule below. The single enumerated list in this system
 * is the acceptance file, which records the placements an owner has already
 * seen; it lives at `docs/reference/types-boundary-acceptance.json`.
 *
 * ---------------------------------------------------------------------------
 * THE SUBJECT
 * ---------------------------------------------------------------------------
 *
 * Every function-like declaration under `packages/types/src` that can be named:
 * function declarations, arrow and function expressions bound to a variable,
 * object-literal and class methods. Anonymous callbacks are attributed to the
 * innermost named function that contains them.
 *
 * Not the subject: types, interfaces, enums, and every data declaration,
 * however large. A frozen catalog, a threshold record, and a price table carry
 * no rule-2 risk, because reading a published constant is the contract the
 * package exists to publish.
 *
 * A value is PARAMETER-DERIVED inside a function when it is one of that
 * function's parameters, or a local seeded from one. Rule 2 is about what the
 * package does to a caller's MEASUREMENTS, so every clause below is scoped to
 * parameter-derived values. Work over module constants alone is contract
 * assembly, not derivation.
 *
 * ---------------------------------------------------------------------------
 * THE THREE CLAUSES
 * ---------------------------------------------------------------------------
 *
 * Three exclusions apply to every clause, because each names work that is
 * demonstrably not about a product measurement:
 *
 *   SIZE AND COUNT ARE NOT MEASUREMENTS. A value built only from `.length`,
 *   `.size`, `.byteLength`, and numeric constants is the shape of the input,
 *   not something measured about the developer. That covers bound checks, byte
 *   accounting, and counters that accumulate a constant per item, which are the
 *   validation and transport work this package is supposed to own. A bare
 *   constant is neutral rather than a size, so comparing a real measurement
 *   against a literal threshold stays visible.
 *
 *   REJECTION IS NOT A VERDICT. A comparison that only guards a `return null`,
 *   `return undefined`, `return false`, or a `throw`, and every comparison
 *   inside a boolean-returning predicate, decides admissibility. Deciding
 *   whether input is well formed is not deciding what it means.
 *
 *   ORDERING IS NOT DERIVATION. Arithmetic inside a `sort` or `toSorted`
 *   comparator arranges values that are already present and produces no number
 *   that leaves the function.
 *
 * EXTRACTION. The function recovers fields from text. All four must hold:
 *   1. it declares at least one `string` parameter;
 *   2. its body decomposes a parameter-derived string with `match`, `matchAll`,
 *      `exec`, or `split`;
 *   3. its return type is not primitive, so the decomposition yields FIELDS;
 *   4. it is not the READ HALF OF A ROUND TRIP. The same file ENCODES a shape
 *      when it declares a function returning `string` that takes a parameter of
 *      that shape: the sentence such a function emits is a textual form this
 *      package defines. A function whose non-nullable return type is a shape the
 *      file encodes is therefore reading back what the file writes, and clause 4
 *      excludes it.
 * A predicate over text returns a boolean and stays. A formatter returns a
 * string and stays. `replace` and case folding normalise rather than recover,
 * so they stay too. Turning a frozen sentence back into numbers does not.
 *
 * Clause 4 is what separates a decoder from an extractor, and the separation is
 * the same one the rule is about. Extraction is deriving stats from raw events:
 * the input is a measurement somebody else produced, and turning it into fields
 * is the work the worker owns. A decoder derives nothing. Its input is a string
 * this package's own encoder emitted, its output is the value that encoder was
 * given, and the two are one wire format with two directions. Publishing only
 * the write half would publish a format no holder of the package can read.
 * Co-location is load-bearing rather than incidental: an encode/decode pair is
 * kept honest by a round-trip test over every case, and a test can only pin two
 * halves it can see.
 *
 * SCORING. The function computes a number the caller did not supply. All three:
 *   1. its body performs a numeric derivation on a parameter-derived value:
 *      an arithmetic operator whose result type is `number` (`+ - * / % **`,
 *      their compound assignments, and `++` / `--`), a `Math.*` call,
 *      `Date.parse`, `.getTime()`, or a `.reduce(` accumulation;
 *   2. that derivation reaches the return value, either lexically inside a
 *      returned expression or through a local the return references;
 *   3. the return type is `number` or is not primitive, so the number escapes.
 * Arithmetic that only reaches a string is presentation and stays.
 *
 * EVALUATION. The function reaches a verdict about measured input. Either:
 *   1. THRESHOLD COMPARISON: a relational operator (`< > <= >=`) applied to a
 *      MEASURED value, meaning one comparand is itself a numeric derivation, is
 *      a local produced by one, or is read from a parameter of non-primitive
 *      type. A bare `number` parameter compared with a literal is a protocol or
 *      range check, not a measurement: `classifyWorkerStatus` reads an HTTP
 *      status code, and ARCHITECTURE.md publishes it on purpose.
 *   2. POLICY SELECTION: the function returns two or more DISTINCT
 *      module-level constants by name, chooses between them on a
 *      parameter-derived branch, and returns a non-primitive type. A constant
 *      reached by a parameter-derived index (`CATALOG[id]`) is a lookup, not a
 *      selection, and does not count; neither does a `null` rejection branch.
 * Clause 2 is what separates a policy resolver from a catalog reader. Exposing
 * a catalog is authorised. Deciding WHICH published constant applies to a
 * subject is the evaluation the worker owns.
 *
 * PROPAGATION. An exported function that calls a function carrying a direct
 * finding carries that finding too, recorded with its origin. A one-line
 * wrapper ships the same implementation as the body it wraps.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DEFINITION DELIBERATELY DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 *
 * It is NARROWER than "carries executable logic". Field-by-field normalisation
 * of a contract shape, closed-set membership guards, zod schema construction,
 * URL assembly, alias resolution against a published registry, and status
 * classification are all executable and all publish safe. `--census` reports
 * the broader executable-logic measure separately, so the two numbers are never
 * confused for each other.
 *
 * EXTRACTION clause 4 is the one place where the evidence is weaker than the
 * claim, and saying so is cheaper than discovering it later. What the code shape
 * proves is that the file writes SOME textual form of the shape being recovered.
 * What clause 4 asserts is that the text being decomposed IS that form. A file
 * that both formatted a shape and parsed a foreign document into the same shape
 * would be cleared wrongly, and nothing in the source separates the two cases:
 * only a round-trip test does, and a test is not the subject. Same-file
 * co-location is the whole of the narrowing, chosen because it is exactly where
 * such a test can see both halves. The residual risk is one file carrying two
 * textual forms of one shape from two authors. The alternative was naming the
 * pair, and a symbol allowlist is what rule 2 refuses by pointing here.
 *
 * ---------------------------------------------------------------------------
 * MODE
 * ---------------------------------------------------------------------------
 *
 * ENFORCEMENT IS THE DEFAULT, and there is no flag that turns it off. An
 * undeclared finding fails, a declared one does not, and an acceptance entry
 * that no longer matches a finding fails too, so the file cannot outlive what
 * it excuses. `docs/reference/types-boundary-acceptance.json` is the only escape
 * hatch, which is how `open-core:check` has always worked. `--census` changes
 * the OUTPUT to the broader executable-logic measure; it does not change the
 * exit code, because a reporting flag that also silences the gate is a way to
 * wire a green nothing into CI.
 *
 * THIS SHIPPED IN REPORT MODE FIRST, AND WHY IT DID IS WORTH KEEPING. Two
 * placements were an open owner decision, and a gate that cannot pass without
 * one is a gate that gets deleted. That decision closed on 2026-08-06 (P6) and
 * both placements stayed. The stated trigger for flipping — "when the acceptance
 * file is empty" — could then never fire: the 15 remaining entries are settled
 * placements with falsification conditions, not deferrals waiting on anybody, so
 * emptiness is not a state this file reaches. A gate whose enforcement condition
 * is unreachable is a gate that is green while covering nothing, which is the
 * same defect as shipping without enforcement at all.
 *
 * RE-VERIFY THE ACCEPTANCE FILE BEFORE TRUSTING A GREEN RUN, and re-verify it
 * against the code rather than against its own prose. Enforcement makes a
 * declared reason permanent, so a wrong one is worse here than it was in report
 * mode. The 2026-08-07 pass that switched this on found six of fifteen entries
 * describing something other than the tree: two rested on "no dollar is stored
 * anywhere", which was false on the day they were written, and four hung on an
 * ADR section that had been superseded two days later. None was a placement
 * error, and every one of them was invisible to this script, because what this
 * script checks is that a finding is declared — never that the declaration is
 * true. That check is a reader's job, and the entries carry line citations so a
 * reader can do it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_SOURCE_ROOT = "packages/types/src";
const ACCEPTANCE_PATH = "docs/reference/types-boundary-acceptance.json";
const ACCEPTANCE_SCHEMA_VERSION = 1;

const COMPILER_OPTIONS = Object.freeze({
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  esModuleInterop: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  noEmit: true,
});

const DECOMPOSITION_METHODS = new Set(["exec", "match", "matchAll", "split"]);
const SIZE_PROPERTIES = new Set(["length", "size", "byteLength"]);
const ORDERING_METHODS = new Set(["sort", "toSorted"]);
const REJECTION_KEYWORDS = new Set([
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.FalseKeyword,
]);

const ARITHMETIC_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

const COMPOUND_ASSIGNMENTS = new Set([
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

const RELATIONAL_OPERATORS = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

const CATEGORIES = Object.freeze(["extraction", "scoring", "evaluation"]);

function sourceFilesUnder(root) {
  if (!existsSync(root)) return [];
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) return sourceFilesUnder(path);
      if (!entry.isFile()) return [];
      return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
    })
    .sort();
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function declaredName(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name),
    );
  }
  return [];
}

function typeConstituents(type) {
  return type.isUnion() ? type.types : [type];
}

const PRIMITIVE_FLAGS =
  ts.TypeFlags.String |
  ts.TypeFlags.Number |
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.Never |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.BigInt |
  ts.TypeFlags.BigIntLiteral |
  ts.TypeFlags.ESSymbol |
  ts.TypeFlags.UniqueESSymbol |
  ts.TypeFlags.Enum |
  ts.TypeFlags.EnumLiteral;

function isPrimitiveType(type) {
  return typeConstituents(type).every(
    (constituent) => (constituent.flags & PRIMITIVE_FLAGS) !== 0,
  );
}

function includesFlag(type, flags) {
  return typeConstituents(type).some((constituent) => (constituent.flags & flags) !== 0);
}

function isStringType(type) {
  return (
    typeConstituents(type).some(
      (constituent) =>
        (constituent.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0,
    ) &&
    typeConstituents(type).every(
      (constituent) =>
        (constituent.flags &
          (ts.TypeFlags.String |
            ts.TypeFlags.StringLiteral |
            ts.TypeFlags.Undefined |
            ts.TypeFlags.Null)) !==
        0,
    )
  );
}

function isNumberType(type) {
  return includesFlag(type, ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral);
}

/** Every constituent is `string`: the function's whole output is prose. */
function isProseType(type) {
  return typeConstituents(type).every(
    (constituent) => (constituent.flags & ts.TypeFlags.String) !== 0,
  );
}

/**
 * ROUND TRIP: the shapes this file writes into text.
 *
 * A function returning `string` that takes a non-primitive parameter encodes
 * that parameter's shape, so the sentence it emits is a textual form this
 * package defines. EXTRACTION clause 4 excludes a function that recovers one of
 * these shapes, because reading back what the same file wrote derives nothing.
 * Types are interned per program, so identity here is the type itself rather
 * than its printed name.
 */
function encodedShapes(functions, checker) {
  const shapes = new Set();
  for (const fn of functions) {
    const signature = checker.getSignatureFromDeclaration(fn);
    if (!signature) continue;
    if (!isProseType(checker.getReturnTypeOfSignature(signature))) continue;
    for (const parameter of fn.parameters) {
      const type = checker.getTypeAtLocation(parameter);
      if (!isPrimitiveType(type)) shapes.add(type);
    }
  }
  return shapes;
}

/**
 * Module-level `const` bindings initialised to an object or array literal, or to
 * `Object.freeze` of one. These are the published constants: catalogs, threshold
 * defaults, price tables, and policy matrices. Returning one is authorised;
 * CHOOSING between them on a measurement is what clause 2 of EVALUATION names.
 */
function moduleConstantNames(file) {
  const names = new Set();
  const isConstantInitializer = (expression) => {
    if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
      return true;
    }
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return isConstantInitializer(expression.expression);
    }
    return (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      ts.isIdentifier(expression.expression.expression) &&
      expression.expression.expression.text === "Object" &&
      expression.expression.name.text === "freeze" &&
      expression.arguments.length === 1 &&
      isConstantInitializer(expression.arguments[0])
    );
  };
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (isConstantInitializer(declaration.initializer)) names.add(declaration.name.text);
    }
  }
  return names;
}

/**
 * The body of one named function, excluding the bodies of the named functions
 * nested inside it. Anonymous callbacks stay, because a `reduce` or an `every`
 * is work the enclosing function does.
 */
function ownedNodes(fn, isOwnBoundary) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    ts.forEachChild(node, (child) => {
      if (child !== fn && isFunctionLike(child) && isOwnBoundary(child)) return;
      walk(child);
    });
  };
  if (fn.body) walk(fn.body);
  return nodes;
}

/**
 * Parameter-derived names inside one function: its own parameters, the
 * parameters of the anonymous callbacks it owns, and every local seeded from
 * one of those. Iterated to a fixpoint over the function's own local
 * declarations.
 */
function parameterDerivedNames(fn, nodes) {
  const derived = new Set();
  for (const parameter of fn.parameters) {
    for (const name of bindingIdentifiers(parameter.name)) derived.add(name);
  }
  for (const node of nodes) {
    if (isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        for (const name of bindingIdentifiers(parameter.name)) derived.add(name);
      }
    }
  }
  // A binding produced by iterating a parameter-derived collection is itself
  // parameter-derived; `for (const model of Object.keys(state.modelTokens))`
  // carries the caller's measurements into the loop body.
  const declarations = nodes.flatMap((node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) return [node];
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      return node.initializer.declarations.map((declaration) => ({
        name: declaration.name,
        initializer: node.expression,
      }));
    }
    return [];
  });
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const names = bindingIdentifiers(declaration.name);
      if (names.every((name) => derived.has(name))) continue;
      if (!referencesAny(declaration.initializer, derived)) continue;
      for (const name of names) {
        if (!derived.has(name)) {
          derived.add(name);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return derived;
}

function referencesAny(node, names) {
  let found = false;
  const walk = (current) => {
    if (found) return;
    if (ts.isIdentifier(current) && names.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

function isDerived(expression, derived) {
  return expression !== undefined && referencesAny(expression, derived);
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function evidenceAt(file, node, text) {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: line + 1, text };
}

function rootIdentifier(expression) {
  let current = unwrap(expression);
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = unwrap(current.expression);
  }
  return ts.isIdentifier(current) ? current : undefined;
}

/**
 * SIZE IS NOT A MEASUREMENT. Classify an expression as a pure size (built from
 * `.length` / `.size` / `.byteLength` and constants), a constant, or something
 * else. A bare constant is neutral: comparing a real measurement against a
 * literal threshold must stay visible.
 */
function sizeShape(expression, locals, seen = new Set()) {
  const inner = unwrap(expression);
  if (ts.isNumericLiteral(inner)) return "constant";
  if (ts.isPropertyAccessExpression(inner)) {
    return SIZE_PROPERTIES.has(inner.name.text) ? "size" : "other";
  }
  const combine = (parts) => {
    if (parts.includes("other")) return "other";
    return parts.includes("size") ? "size" : "constant";
  };
  if (ts.isBinaryExpression(inner)) {
    return combine([
      sizeShape(inner.left, locals, seen),
      sizeShape(inner.right, locals, seen),
    ]);
  }
  if (ts.isConditionalExpression(inner)) {
    return combine([
      sizeShape(inner.whenTrue, locals, seen),
      sizeShape(inner.whenFalse, locals, seen),
    ]);
  }
  if (ts.isPrefixUnaryExpression(inner)) return sizeShape(inner.operand, locals, seen);
  if (ts.isIdentifier(inner)) {
    if (seen.has(inner.text)) return "other";
    const initializer = locals.get(inner.text);
    if (!initializer) return "other";
    seen.add(inner.text);
    return sizeShape(initializer, locals, seen);
  }
  return "other";
}

function isSizeExpression(expression, locals) {
  return sizeShape(expression, locals) === "size";
}

function isNumericDerivationNode(node, checker) {
  if (ts.isBinaryExpression(node) && ARITHMETIC_OPERATORS.has(node.operatorToken.kind)) {
    return isNumberType(checker.getTypeAtLocation(node));
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true;
  }
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(node.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const receiver = unwrap(callee.expression);
  const method = callee.name.text;
  if (ts.isIdentifier(receiver) && receiver.text === "Math") return true;
  if (ts.isIdentifier(receiver) && receiver.text === "Date" && method === "parse") return true;
  if (method === "getTime" || method === "valueOf") return true;
  if (method === "reduce" || method === "reduceRight") {
    return isNumberType(checker.getTypeAtLocation(node));
  }
  return false;
}

function containsNumericDerivation(expression, checker) {
  let found = false;
  const walk = (node) => {
    if (found) return;
    if (isNumericDerivationNode(node, checker)) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(expression);
  return found;
}

/** ORDERING IS NOT DERIVATION: work inside a sort comparator. */
function insideComparator(node, fn) {
  let current = node.parent;
  while (current && current !== fn) {
    if (isFunctionLike(current)) {
      const call = current.parent;
      if (
        call &&
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(unwrap(call.expression)) &&
        ORDERING_METHODS.has(unwrap(call.expression).name.text)
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function isRejectionValue(expression) {
  if (expression === undefined) return true;
  const inner = unwrap(expression);
  if (REJECTION_KEYWORDS.has(inner.kind)) return true;
  return ts.isIdentifier(inner) && inner.text === "undefined";
}

function branchOnlyRejects(statement) {
  if (!statement) return false;
  let sawExit = false;
  let allReject = true;
  const walk = (node) => {
    if (ts.isReturnStatement(node)) {
      sawExit = true;
      if (!isRejectionValue(node.expression)) allReject = false;
    } else if (ts.isThrowStatement(node)) {
      sawExit = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(statement);
  return sawExit && allReject;
}

/** REJECTION IS NOT A VERDICT. */
function onlyGuardsRejection(node, fn, checker) {
  const signature = checker.getSignatureFromDeclaration(fn);
  if (signature) {
    const returnType = checker.getReturnTypeOfSignature(signature);
    const booleanOnly = typeConstituents(returnType).every(
      (constituent) =>
        (constituent.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0,
    );
    if (booleanOnly) return true;
  }
  let child = node;
  let current = node.parent;
  while (current && current !== fn) {
    if (ts.isIfStatement(current) && current.expression.pos <= child.pos) {
      const withinCondition =
        child === current.expression ||
        (child.pos >= current.expression.pos && child.end <= current.expression.end);
      if (withinCondition) {
        return (
          branchOnlyRejects(current.thenStatement) &&
          (current.elseStatement === undefined || branchOnlyRejects(current.elseStatement))
        );
      }
    }
    child = current;
    current = current.parent;
  }
  return false;
}

function localInitializerMap(nodes) {
  const locals = new Map();
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (!locals.has(node.name.text)) locals.set(node.name.text, node.initializer);
    }
  }
  return locals;
}

function numericallyDerivedLocals(nodes, checker) {
  const names = new Set();
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (containsNumericDerivation(node.initializer, checker)) names.add(node.name.text);
      continue;
    }
    if (isAssignment(node) && containsNumericDerivation(node.right, checker)) {
      names.add(node.left.text);
    }
  }
  return names;
}

/** Names a return expression reads, closed backwards over local initialisers. */
function returnedNames(fn, nodes, locals) {
  const names = new Set();
  const add = (expression) => {
    const walk = (node) => {
      if (ts.isIdentifier(node)) names.add(node.text);
      ts.forEachChild(node, walk);
    };
    walk(expression);
  };
  for (const node of nodes) {
    if (ts.isReturnStatement(node) && node.expression) add(node.expression);
  }
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) add(fn.body);
  for (let pass = 0; pass <= locals.size; pass += 1) {
    let changed = false;
    for (const [name, initializer] of locals) {
      if (!names.has(name)) continue;
      const before = names.size;
      add(initializer);
      if (names.size !== before) changed = true;
    }
    if (!changed) break;
  }
  return names;
}

function isAssignment(node) {
  return (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      COMPOUND_ASSIGNMENTS.has(node.operatorToken.kind)) &&
    ts.isIdentifier(node.left)
  );
}

/** Does this derivation reach the value the function returns? */
function reachesReturn(node, fn, returned) {
  if (isAssignment(node)) return returned.has(node.left.text);
  let current = node.parent;
  while (current && current !== fn) {
    if (ts.isReturnStatement(current)) return true;
    if (ts.isVariableDeclaration(current)) {
      return bindingIdentifiers(current.name).some((name) => returned.has(name));
    }
    if (isAssignment(current)) return returned.has(current.left.text);
    current = current.parent;
  }
  return ts.isArrowFunction(fn) && fn.body !== undefined && !ts.isBlock(fn.body);
}

function detectExtraction(fn, ctx, checker, file, encoded) {
  const hasStringParameter = fn.parameters.some((parameter) =>
    isStringType(checker.getTypeAtLocation(parameter)),
  );
  if (!hasStringParameter) return undefined;
  const signature = checker.getSignatureFromDeclaration(fn);
  if (!signature) return undefined;
  const returnType = checker.getReturnTypeOfSignature(signature);
  if (isPrimitiveType(returnType)) return undefined;
  // Clause 4: the read half of a round trip recovers what this file encodes.
  if (encoded.has(checker.getNonNullableType(returnType))) return undefined;

  for (const node of ctx.nodes) {
    if (!ts.isCallExpression(node)) continue;
    const callee = unwrap(node.expression);
    if (!ts.isPropertyAccessExpression(callee)) continue;
    if (!DECOMPOSITION_METHODS.has(callee.name.text)) continue;
    const receiver = unwrap(callee.expression);
    const receiverIsText = isStringType(checker.getTypeAtLocation(receiver));
    const receiverIsPattern =
      ts.isRegularExpressionLiteral(receiver) ||
      (ts.isNewExpression(receiver) &&
        ts.isIdentifier(receiver.expression) &&
        receiver.expression.text === "RegExp");
    const argumentsDerived = node.arguments.some((argument) =>
      isDerived(argument, ctx.derived),
    );
    if (receiverIsText && isDerived(receiver, ctx.derived)) {
      return evidenceAt(file, node, `${callee.name.text} decomposes parameter-derived text`);
    }
    if (receiverIsPattern && argumentsDerived) {
      return evidenceAt(file, node, `${callee.name.text} decomposes parameter-derived text`);
    }
  }
  return undefined;
}

function detectScoring(fn, ctx, checker, file) {
  const signature = checker.getSignatureFromDeclaration(fn);
  if (!signature) return undefined;
  const returnType = checker.getReturnTypeOfSignature(signature);
  if (!isNumberType(returnType) && isPrimitiveType(returnType)) return undefined;

  for (const node of ctx.nodes) {
    if (!isNumericDerivationNode(node, checker)) continue;
    if (insideComparator(node, fn)) continue;
    // Size and count are not measurements: a derivation built only from
    // `.length`-family reads and constants counts the input rather than
    // measuring anything about the developer.
    if (sizeShape(node, ctx.locals) !== "other") continue;
    const operands = ts.isBinaryExpression(node)
      ? [node.left, node.right]
      : ts.isCallExpression(node)
        ? [...node.arguments, unwrap(unwrap(node.expression).expression ?? node.expression)]
        : [node.operand];
    if (!operands.some((operand) => operand && isDerived(operand, ctx.derived))) continue;
    if (!reachesReturn(node, fn, ctx.returned)) continue;
    const label = ts.isBinaryExpression(node)
      ? `numeric ${ts.tokenToString(node.operatorToken.kind)} over a parameter-derived value`
      : ts.isCallExpression(node)
        ? `${unwrap(node.expression).getText(file)} derives a number from a parameter`
        : "increments a parameter-derived value";
    return evidenceAt(file, node, label);
  }
  return undefined;
}

function returnExpressions(fn, nodes) {
  const expressions = [];
  for (const node of nodes) {
    if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression);
  }
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) expressions.push(fn.body);
  const conditionals = [];
  for (const expression of expressions) {
    const walk = (current) => {
      const inner = unwrap(current);
      if (ts.isConditionalExpression(inner)) {
        walk(inner.whenTrue);
        walk(inner.whenFalse);
        return;
      }
      if (
        ts.isBinaryExpression(inner) &&
        (inner.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          inner.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        walk(inner.left);
        walk(inner.right);
        return;
      }
      conditionals.push(inner);
    };
    walk(expression);
  }
  return conditionals;
}

/**
 * Which published constants a returned expression carries BY NAME. A constant
 * reached through a parameter-derived index is a catalog lookup, not a
 * selection, and is deliberately not counted.
 */
function namedConstantsIn(expression, constants, seeds, derived) {
  const found = new Set();
  const walk = (candidate) => {
    const inner = unwrap(candidate);
    if (ts.isIdentifier(inner)) {
      if (constants.has(inner.text)) found.add(inner.text);
      for (const name of seeds.get(inner.text) ?? []) found.add(name);
      return;
    }
    if (ts.isElementAccessExpression(inner)) {
      if (isDerived(inner.argumentExpression, derived)) return;
      walk(inner.expression);
      return;
    }
    if (ts.isPropertyAccessExpression(inner) || ts.isSpreadElement(inner)) {
      walk(inner.expression);
      return;
    }
    if (ts.isObjectLiteralExpression(inner)) {
      for (const property of inner.properties) {
        if (ts.isSpreadAssignment(property)) walk(property.expression);
      }
    }
  };
  walk(expression);
  return found;
}

function localsSeededFromConstants(nodes, constants, derived) {
  const seeds = new Map();
  const declarations = nodes.filter(
    (node) => ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name),
  );
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const carried = namedConstantsIn(declaration.initializer, constants, seeds, derived);
      if (carried.size === 0) continue;
      const existing = seeds.get(declaration.name.text);
      if (existing && [...carried].every((name) => existing.has(name))) continue;
      seeds.set(declaration.name.text, new Set([...(existing ?? []), ...carried]));
      changed = true;
    }
    if (!changed) break;
  }
  return seeds;
}

function isMeasuredComparand(expression, ctx, checker, seen = new Set()) {
  if (isSizeExpression(expression, ctx.locals)) return false;
  if (!isNumberType(checker.getTypeAtLocation(expression))) return false;
  if (containsNumericDerivation(expression, checker)) return true;
  const inner = unwrap(expression);
  if (ts.isIdentifier(inner)) {
    if (ctx.numericLocals.has(inner.text)) return true;
    // Resolve through the local so that binding a measurement to a name first
    // reads exactly like comparing it inline.
    const initializer = ctx.locals.get(inner.text);
    if (!initializer || seen.has(inner.text)) return false;
    seen.add(inner.text);
    return isMeasuredComparand(initializer, ctx, checker, seen);
  }
  if (!ts.isPropertyAccessExpression(inner) && !ts.isElementAccessExpression(inner)) {
    return false;
  }
  const root = rootIdentifier(inner);
  if (!root || !ctx.derived.has(root.text)) return false;
  const parameter = ctx.parameters.get(root.text);
  if (parameter) return !isPrimitiveType(checker.getTypeAtLocation(parameter));
  if (ctx.numericLocals.has(root.text)) return true;
  const initializer = ctx.locals.get(root.text);
  if (!initializer || seen.has(root.text)) return false;
  seen.add(root.text);
  return isMeasuredComparand(initializer, ctx, checker, seen);
}

function detectEvaluation(fn, ctx, checker, file, constants) {
  const signature = checker.getSignatureFromDeclaration(fn);
  // A comparison whose only consequence is which SENTENCE comes out is
  // presentation, the same exclusion SCORING already makes for arithmetic that
  // only reaches a string.
  const producesProse =
    signature !== undefined &&
    isProseType(checker.getReturnTypeOfSignature(signature));
  for (const node of producesProse ? [] : ctx.nodes) {
    if (!ts.isBinaryExpression(node)) continue;
    if (!RELATIONAL_OPERATORS.has(node.operatorToken.kind)) continue;
    if (insideComparator(node, fn)) continue;
    const sides = [node.left, node.right];
    if (sides.some((side) => isSizeExpression(side, ctx.locals))) continue;
    if (!sides.some((side) => isDerived(side, ctx.derived))) continue;
    if (!sides.some((side) => isMeasuredComparand(side, ctx, checker))) continue;
    if (onlyGuardsRejection(node, fn, checker)) continue;
    return evidenceAt(
      file,
      node,
      `compares a measured value with ${ts.tokenToString(node.operatorToken.kind)}`,
    );
  }

  const returns = returnExpressions(fn, ctx.nodes).filter(
    (expression) => !isRejectionValue(expression),
  );
  if (returns.length < 2) return undefined;
  if (!signature) return undefined;
  if (isPrimitiveType(checker.getReturnTypeOfSignature(signature))) return undefined;
  const seeds = localsSeededFromConstants(ctx.nodes, constants, ctx.derived);
  const named = new Set();
  for (const expression of returns) {
    for (const name of namedConstantsIn(expression, constants, seeds, ctx.derived)) {
      named.add(name);
    }
  }
  if (named.size < 2) return undefined;

  const branchesOnMeasurement = ctx.nodes.some((node) => {
    if (ts.isIfStatement(node)) return isDerived(node.expression, ctx.derived);
    if (ts.isSwitchStatement(node)) return isDerived(node.expression, ctx.derived);
    if (ts.isConditionalExpression(node)) return isDerived(node.condition, ctx.derived);
    return false;
  });
  if (!branchesOnMeasurement) return undefined;
  return evidenceAt(
    file,
    returns[0],
    `selects between published constants (${[...named].sort().join(", ")}) on its input`,
  );
}

function exportedDeclarations(checker, file) {
  const declarations = new Set();
  const symbol = checker.getSymbolAtLocation(file);
  if (!symbol) return declarations;
  for (const exported of checker.getExportsOfModule(symbol)) {
    const target =
      (exported.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(exported)
        : exported;
    for (const declaration of target.getDeclarations() ?? []) {
      declarations.add(declaration);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        declarations.add(unwrap(declaration.initializer));
      }
    }
  }
  return declarations;
}

/**
 * Analyse one source root. `repositoryRoot` only shapes the reported paths.
 */
export function analyzePublishSafety(sourceRoot, repositoryRoot = sourceRoot) {
  const fileNames = sourceFilesUnder(sourceRoot);
  const program = ts.createProgram(fileNames, COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const units = [];
  const byDeclaration = new Map();

  for (const fileName of fileNames) {
    const file = program.getSourceFile(fileName);
    if (!file) continue;
    const path = relative(repositoryRoot, fileName).split(sep).join("/");
    const constants = moduleConstantNames(file);
    const exported = exportedDeclarations(checker, file);
    const named = [];
    const collect = (node) => {
      if (isFunctionLike(node) && declaredName(node) !== undefined) named.push(node);
      ts.forEachChild(node, collect);
    };
    collect(file);
    const isOwnBoundary = (node) => named.includes(node);
    const encoded = encodedShapes(named, checker);

    for (const fn of named) {
      const nodes = ownedNodes(fn, isOwnBoundary);
      if (nodes.length === 0) continue;
      const derived = parameterDerivedNames(fn, nodes);
      const locals = localInitializerMap(nodes);
      const ctx = {
        nodes,
        derived,
        locals,
        numericLocals: numericallyDerivedLocals(nodes, checker),
        returned: returnedNames(fn, nodes, locals),
        parameters: new Map(
          fn.parameters
            .filter((parameter) => ts.isIdentifier(parameter.name))
            .map((parameter) => [parameter.name.text, parameter]),
        ),
      };
      const { line } = file.getLineAndCharacterOfPosition(fn.getStart(file));
      const unit = {
        file: path,
        symbol: declaredName(fn),
        line: line + 1,
        exported: exported.has(fn) || exported.has(fn.parent),
        findings: [],
        calls: new Set(),
      };
      const detected = {
        extraction: detectExtraction(fn, ctx, checker, file, encoded),
        scoring: detectScoring(fn, ctx, checker, file),
        evaluation: detectEvaluation(fn, ctx, checker, file, constants),
      };
      for (const category of CATEGORIES) {
        const evidence = detected[category];
        if (evidence === undefined) continue;
        unit.findings.push({
          file: path,
          symbol: unit.symbol,
          line: evidence.line,
          category,
          evidence: evidence.text,
          origin: "direct",
        });
      }
      for (const node of nodes) {
        if (!ts.isCallExpression(node)) continue;
        const callee = unwrap(node.expression);
        const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        if (!ts.isIdentifier(target)) continue;
        const symbol = checker.getSymbolAtLocation(target);
        if (!symbol) continue;
        const resolved =
          (symbol.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        for (const declaration of resolved.getDeclarations() ?? []) {
          unit.calls.add(declaration);
          if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
            unit.calls.add(unwrap(declaration.initializer));
          }
        }
      }
      units.push(unit);
      byDeclaration.set(fn, unit);
    }
  }

  // PROPAGATION: an exported wrapper ships what it wraps.
  for (let pass = 0; pass <= units.length; pass += 1) {
    let changed = false;
    for (const unit of units) {
      if (!unit.exported) continue;
      for (const declaration of unit.calls) {
        const target = byDeclaration.get(declaration);
        if (!target || target === unit) continue;
        for (const finding of target.findings) {
          const already = unit.findings.some(
            (existing) => existing.category === finding.category,
          );
          if (already) continue;
          unit.findings.push({
            file: unit.file,
            symbol: unit.symbol,
            line: unit.line,
            category: finding.category,
            evidence: finding.evidence,
            origin: `calls ${target.symbol} (${target.file}:${finding.line})`,
          });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const findings = units
    .flatMap((unit) => unit.findings)
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.category.localeCompare(right.category),
    );

  const executableFiles = [
    ...new Set(units.filter((unit) => unit.exported).map((unit) => unit.file)),
  ].sort();

  return {
    fileCount: fileNames.length,
    functionCount: units.length,
    executableFiles,
    findings,
  };
}

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
  for (const [index, entry] of parsed.entries.entries()) {
    const missing = ["file", "symbol", "category", "acceptedOn", "why", "falsifiedWhen"].filter(
      (field) => typeof entry?.[field] !== "string" || entry[field].length === 0,
    );
    if (missing.length > 0) {
      problems.push(`${path} entry ${index} is missing ${missing.join(", ")}`);
      continue;
    }
    if (!CATEGORIES.includes(entry.category)) {
      problems.push(`${path} entry ${index} has unknown category ${entry.category}`);
      continue;
    }
    entries.push(entry);
  }
  return { entries, problems };
}

function keyOf(entry) {
  return `${entry.file}::${entry.symbol}::${entry.category}`;
}

export function reconcile(findings, entries) {
  const byKey = new Map(entries.map((entry) => [keyOf(entry), entry]));
  const seen = new Set();
  const accepted = [];
  const undeclared = [];
  for (const finding of findings) {
    const key = keyOf(finding);
    const entry = byKey.get(key);
    if (entry) {
      seen.add(key);
      accepted.push({ ...finding, acceptance: entry });
    } else {
      undeclared.push(finding);
    }
  }
  const stale = entries.filter((entry) => !seen.has(keyOf(entry)));
  return { accepted, undeclared, stale };
}

function formatFinding(finding) {
  const origin = finding.origin === "direct" ? "" : ` (${finding.origin})`;
  return `${finding.file}:${finding.line} ${finding.symbol} [${finding.category}] ${finding.evidence}${origin}`;
}

export function formatReport(analysis, reconciliation, acceptanceProblems) {
  const lines = [];
  lines.push(
    "Types boundary check (enforcing). Definition: scripts/check-types-publish-safety.mjs.",
  );
  lines.push(
    `Scanned ${analysis.fileCount} source files and ${analysis.functionCount} named functions in ${PACKAGE_SOURCE_ROOT}.`,
  );
  lines.push(
    `${analysis.executableFiles.length} of ${analysis.fileCount} files export at least one function.`,
  );
  for (const problem of acceptanceProblems) lines.push(`! acceptance file: ${problem}`);

  const { accepted, undeclared, stale } = reconciliation;
  lines.push("");
  lines.push(`Accepted placements (${accepted.length}):`);
  for (const finding of accepted) {
    lines.push(`  - ${formatFinding(finding)}`);
    lines.push(
      `      accepted ${finding.acceptance.acceptedOn}; falsified when ${finding.acceptance.falsifiedWhen}`,
    );
  }
  lines.push("");
  lines.push(`Undeclared placements (${undeclared.length}):`);
  for (const finding of undeclared) lines.push(`  - ${formatFinding(finding)}`);
  if (stale.length > 0) {
    lines.push("");
    lines.push(`Acceptance entries with no matching placement (${stale.length}):`);
    for (const entry of stale) {
      lines.push(`  - ${entry.file} ${entry.symbol} [${entry.category}] is falsified, remove it`);
    }
  }
  lines.push("");
  lines.push(
    "An undeclared placement fails this check, and so does an acceptance entry whose placement is gone. docs/reference/types-boundary-acceptance.json is the only escape hatch, and no flag disables enforcement. A green run means every placement is DECLARED, never that its declared reason is still true: that is a reader's job, against the code and the line citations each entry carries.",
  );
  return lines.join("\n");
}

export function checkTypesPublishSafety(repositoryRoot = REPO_ROOT) {
  const analysis = analyzePublishSafety(
    resolve(repositoryRoot, PACKAGE_SOURCE_ROOT),
    repositoryRoot,
  );
  const { entries, problems } = readAcceptance(repositoryRoot);
  return { analysis, reconciliation: reconcile(analysis.findings, entries), problems };
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  // `--root` exists so the test can drive this executable against a fixture
  // repository, including one with a deliberately planted violation.
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const { analysis, reconciliation, problems } = checkTypesPublishSafety(
    rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT,
  );
  if (process.argv.includes("--census")) {
    console.log(
      JSON.stringify(
        {
          fileCount: analysis.fileCount,
          functionCount: analysis.functionCount,
          executableFiles: analysis.executableFiles,
          findings: analysis.findings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatReport(analysis, reconciliation, problems));
  }
  // Deliberately outside the `--census` branch: the census changes what is
  // printed, never whether the gate holds.
  if (
    problems.length > 0 ||
    reconciliation.undeclared.length > 0 ||
    reconciliation.stale.length > 0
  ) {
    process.exitCode = 1;
  }
}
