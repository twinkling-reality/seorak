#!/usr/bin/env node

/**
 * check-plane-work.mjs: does the local plane still do its heavy work off the
 * thread that answers requests, and does its recurring work still bound itself?
 *
 * WHY THIS IS A GATE AND NOT FIVE PATCHES. The collector's data plane had five
 * separate responsiveness defects and they were one defect wearing five faces:
 * `node:sqlite` has no async API, so any statement blocks the thread it runs on
 * for its whole duration, and the daemon serves the dashboard from the same
 * process that captures. Three seams were built to answer that (a projection
 * worker thread, a memo keyed on the event high-water mark, and budgets that
 * refuse rather than truncate), and seams do not hold on their own. Patching the
 * routes one at a time leaves the sixth to be written next month, against a
 * reviewer who has to remember that the rule exists. This is what remembers.
 *
 * WHAT WAS MEASURED, on the author's 345,764-row history on 2026-09-09:
 *
 *   - `buildLocalOverviewProjectionOn` folds in 2,312 ms at 90 days and
 *     2,568 ms at 30. `queryLocalPrivatePeriod` held that fold inside
 *     `BEGIN IMMEDIATE`, so an API read held SQLite's write lock for two and a
 *     half seconds and the collector's own capture appends queued behind it. A
 *     concurrent writer's worst single-append wait was 3,456 ms against the
 *     5,000 ms `busy_timeout` in `openLocalHistory`; after the transaction was
 *     split it was 653 ms.
 *   - `buildLocalDeveloperModel` took 2,200 ms inline at 90 days before it moved
 *     off-thread.
 *   - The live board's per-session fan-out cost 12.3 ms over 1,003 sessions
 *     while a third of its statements re-read `local_session` rows the caller
 *     was already holding. Two statements per session cost 8.0 ms.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES
 * ---------------------------------------------------------------------------
 *
 * RULE 1, INLINE WINDOW FOLDS. A plane route may not fold a WINDOW inline.
 * Anything reachable from a declared entry point that calls a `buildLocal*`
 * function taking a `rangeDays` must go through `serveProjection`, which is the
 * one place the memo, the worker thread, and the inline fallback are wired
 * together.
 *
 * THE HANDOFF ASKED FOR THIS RULE OVER EVERY BUILDER, AND THAT VERSION MEANS
 * NOTHING. Run it: it reports eight findings on a tree whose two known-bad
 * folds are already wrapped, because it cannot tell a window fold from a
 * per-session read. They are different cost classes and the numbers are not
 * close. Measured on the author's history on 2026-09-09: a 90-day window fold
 * is 2,312 ms and a 30-day one 2,568 ms, while the largest single session in
 * 5,605 answers a replay in 97 ms and an outcome in 29 ms, and the live board at
 * its real 30-minute horizon is four sessions and 0.6 ms. Eight findings needing
 * eight acceptance entries is a rule that has been talked out of firing, and the
 * next reader learns to add a ninth. Scoped to window folds it reports exactly
 * one, which is the one that is still true.
 *
 * A per-session read is not thereby unbounded. It is rule 2's, because what
 * grows there is the rows one session holds, and a row budget is the control
 * that fits that. A window fold grows with the whole history and no budget
 * helps, which is why it needs a different thread rather than a smaller number.
 *
 * RULE 2, UNDECLARED BUDGETS. A builder that ACCEPTS a `rowBudget` must be
 * passed one from the route, or be accepted here by name. `rowBudget` defaults
 * to null, which means unbounded, so a call site that simply omits it is
 * indistinguishable from one that thought about it and chose not to bound. That
 * is the shape `/replay/:id` had: it passed no budget at all and both bindings
 * read every row of a session with no window, while the outcome route three
 * lines above it refused exactly that shape on a routable socket. `rowBudget:
 * null` stops being a shrug and becomes an entry in the acceptance file.
 *
 * RULE 3, UNGUARDED TICKS. Every `managedInterval` tick in the daemon carries a
 * re-entrancy guard, and it must RELEASE it: a flag that is tested and taken but
 * never set back to false is a run-once latch, which stops the work altogether
 * and is strictly worse than the overlap it was added to prevent.
 *
 * A tick whose work can outlast its own interval and that does not refuse to
 * overlap itself runs two copies of that work. In `syncCaptureSettings`'s case
 * the cost is not a torn file (its `writeFileSync` and `renameSync` are adjacent
 * synchronous calls and cannot interleave) but response REORDERING: two syncs in
 * flight, the older lands second, and the capture toggles left on disk are the
 * stale ones.
 *
 * RULE 3 DOES NOT REQUIRE A TIME BUDGET, AND THE HANDOFF THAT ASKED FOR THIS
 * GATE SAID IT SHOULD. It asked for "re-entrancy guarded AND time budgeted",
 * and that rule is red on a correct tree: three of the five ticks are guarded
 * and carry no time budget, and they do not need one. A tick that spawns a git
 * subprocess per repository needs a deadline it checks at the cheap/expensive
 * boundary, which is what `survivalBlameBudgetMs()` gives the momentum sweep. A
 * tick that awaits one HTTP request already has its bound in the AbortSignal it
 * is handed. A gate that fails correct code gets weakened rather than obeyed,
 * which is the exact failure `check-gate-coverage.mjs` was written after. So the
 * guard is mechanical and required, and the time budget is DECLARED per tick in
 * the acceptance file's `ticks` table: the gate refuses a tick nobody has
 * classified, which is the part that does not rot.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT SEE, SAID OUT LOUD
 * ---------------------------------------------------------------------------
 *
 * The walk follows a call whose callee is a bare identifier. It does not follow
 * a method call, a call through a variable, or a dynamic import. That is not a
 * shortcut, it is the boundary of what a parser without a type checker can
 * honestly claim, and the plane has one real instance of it: `handleRequest`
 * reaches the mounted MCP surface through `integrations.serveMcp(...)`, a method
 * on a class. So the MCP query handlers are a DECLARED entry point rather than a
 * discovered one, and `REACH_FLOOR` below fails if the walk stops reaching a
 * module it is supposed to reach. Without that floor, a refactor that made the
 * walk blind would report clean, which is worse than reporting nothing.
 *
 * THE BUILDER SET IS DERIVED, NEVER LISTED. It is every exported function in
 * `local-projection.ts` whose name begins with `buildLocal`. A hand-written list
 * of the twelve builders that exist today would be green forever and would not
 * see the thirteenth.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import {
  exitCodeFor,
  formatAcceptanceSection,
  readAcceptance,
  reconcile,
  REPO_ROOT,
} from "./open-core-ownership.mjs";

export const CHECK_ID = "plane-work";
export const ACCEPTANCE_PATH = "docs/reference/plane-work-acceptance.json";
export const SOURCE_ROOT = "packages/collector/src";
export const BUILDER_MODULE = "local-projection.ts";
export const DAEMON_MODULE = "daemon.ts";
export const WRAPPER = "serveProjection";
export const INTERVAL_FACTORY = "managedInterval";
/** Only a name starting this way is a projection builder, and every exported
 *  function in the builder module that starts this way is one. */
const BUILDER_PREFIX = "buildLocal";

/**
 * Where a request enters. Declared rather than discovered, because two of the
 * three are reached in a form the walk cannot follow and the third is the
 * server callback itself.
 */
export const ENTRY_POINTS = Object.freeze([
  Object.freeze({
    module: "local-plane.ts",
    function: "handleRequest",
    why: "The plane's own request handler, whose route switch answers every first-party surface on both the loopback and the self-hosted binding.",
  }),
  Object.freeze({
    module: "local-private-http.ts",
    function: "handleLocalPrivateApi",
    why: "The versioned private integration API. Reached from handleRequest as a bare identifier, so the walk would find it anyway; declared so that a change in the call form cannot silently drop the whole API family from rule 1.",
  }),
  Object.freeze({
    module: "local-private-mcp.ts",
    function: "createLocalPrivateMcpQueryHandlers",
    why: "The mounted stateless MCP resource's query handlers. NOT reachable by the walk: handleRequest reaches MCP through integrations.serveMcp(...), a method call on a class, and the walk follows bare identifiers only.",
  }),
]);

/**
 * Modules the walk must still reach. A floor, not a list to grow: reaching zero
 * of these means the walk went blind, and a blind walk reports clean.
 */
export const REACH_FLOOR = Object.freeze([
  Object.freeze({
    module: "local-plane.ts",
    minBuilderCalls: 5,
    why: "Holds the route switch and serveProjection itself.",
  }),
  Object.freeze({
    module: "local-private-queries.ts",
    minBuilderCalls: 3,
    why: "Holds queryLocalPrivatePeriod, which is where the worst fold in the plane's history lived. A gate that reads only local-plane.ts route bodies reports clean on it, which is why the reach crosses modules at all.",
  }),
]);

export class PlaneWorkCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaneWorkCheckError";
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function parseModule(source, path) {
  // setParentNodes must be true: `wrappedBy` walks upward from a call site.
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** The same relative-specifier resolution `check-projection-closure.mjs` uses,
 *  so both gates agree on what an import points at. */
function resolveRelativeModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    `${base}/index.ts`,
    base,
  ]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A module's walkable declarations and its relative-import bindings.
 *
 * A declaration is walkable when it has a body this gate can descend into: a
 * function declaration, or a `const` bound to an arrow or function expression.
 */
function moduleIndex(file, source) {
  const tree = parseModule(source, file);
  const declarations = new Map();
  const imports = new Map();
  const exportedFunctions = new Map();
  const namedTypes = new Map();
  const namespaces = new Map();
  for (const statement of tree.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      namedTypes.set(statement.name.text, statement);
    }
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) continue;
      const clause = statement.importClause;
      if (clause === undefined) continue;
      const bindings = clause.namedBindings;
      if (clause.name !== undefined) {
        imports.set(clause.name.text, { specifier: specifier.text, importedName: "default" });
      }
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        // `import * as projection from "./local-projection.ts"` then
        // `projection.buildLocalOverview(...)`. Recorded so the member-call
        // branch of the walk can recognise it instead of counting it as one more
        // unfollowable method call.
        namespaces.set(bindings.name.text, specifier.text);
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, {
            specifier: specifier.text,
            importedName: (element.propertyName ?? element.name).text,
          });
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declarations.set(statement.name.text, statement);
      if (isExported(statement)) exportedFunctions.set(statement.name.text, statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer === undefined || !ts.isIdentifier(declaration.name)) continue;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          declarations.set(declaration.name.text, initializer);
          if (isExported(statement)) {
            exportedFunctions.set(declaration.name.text, initializer);
          }
        }
      }
    }
  }
  return { file, tree, declarations, imports, exportedFunctions, namedTypes, namespaces };
}

function isExported(node) {
  return (
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/* -------------------------------------------------------------------------- */
/* The builder set, derived from the builder module's own exports              */
/* -------------------------------------------------------------------------- */

/**
 * Every `buildLocal*` the builder module exports, classified by the two
 * parameters that decide which rule it answers to.
 *
 * `windowed` means it takes a `rangeDays`, so its cost grows with the whole
 * history and rule 1 applies. `budgeted` means it takes a `rowBudget`, so its
 * cost grows with one session and rule 2 applies. A builder can be neither, and
 * then this gate has nothing to say about it, which is the honest answer rather
 * than a finding nobody can act on.
 */
export function builderSet(source, file = BUILDER_MODULE) {
  const index = moduleIndex(file, source);
  const builders = new Map();
  for (const [name, node] of index.exportedFunctions) {
    if (!name.startsWith(BUILDER_PREFIX)) continue;
    builders.set(name, {
      budgeted: acceptsProperty(node, "rowBudget", index.namedTypes),
      windowed: acceptsProperty(node, "rangeDays", index.namedTypes),
    });
  }
  return builders;
}

/**
 * True when any parameter's type carries a property of this name.
 *
 * It has to FOLLOW NAMED TYPES, not just descend the type node, and the two
 * properties this gate asks about are why: `rowBudget` is written inline as an
 * intersection (`LocalReadOptions & { rowBudget?: number | null }`) while
 * `rangeDays` is a member of the named `LocalOverviewOptions`, which itself
 * `extends LocalReadOptions`. A version of this that only descended the type
 * node found every `rowBudget` and no `rangeDays`, so rule 1 reported clean on
 * the one fold in the tree that is still inline. That is the failure mode a
 * static gate has to be tested against rather than reasoned about.
 *
 * Resolution is confined to types declared in the SAME module, which is where
 * all of them are, and `seen` makes a self-referential type terminate.
 */
function acceptsProperty(node, property, namedTypes = new Map()) {
  const seen = new Set();
  let found = false;
  const visit = (child) => {
    if (found || child === undefined) return;
    if (
      ts.isPropertySignature(child) &&
      ts.isIdentifier(child.name) &&
      child.name.text === property
    ) {
      found = true;
      return;
    }
    if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName)) {
      const name = child.typeName.text;
      if (!seen.has(name)) {
        seen.add(name);
        const declaration = namedTypes.get(name);
        if (declaration !== undefined) {
          if (ts.isInterfaceDeclaration(declaration)) {
            for (const member of declaration.members) visit(member);
            for (const clause of declaration.heritageClauses ?? []) {
              for (const type of clause.types) visit(type.expression);
              for (const type of clause.types) visit(type);
            }
          } else {
            visit(declaration.type);
          }
        }
      }
    }
    // An `extends` clause's expression is an Identifier, not a TypeReference,
    // so it is resolved by name here too.
    if (ts.isIdentifier(child) && namedTypes.has(child.text) && !seen.has(child.text)) {
      seen.add(child.text);
      const declaration = namedTypes.get(child.text);
      if (ts.isInterfaceDeclaration(declaration)) {
        for (const member of declaration.members) visit(member);
        for (const clause of declaration.heritageClauses ?? []) {
          for (const type of clause.types) visit(type.expression);
        }
      } else {
        visit(declaration.type);
      }
    }
    ts.forEachChild(child, visit);
  };
  for (const parameter of node.parameters) visit(parameter.type);
  return found;
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                    */
/* -------------------------------------------------------------------------- */

/** Every call expression lexically inside a node, including the ones nested in
 *  arrow bodies, object-literal property initializers, and immediately-invoked
 *  expressions. The plane's routes and the daemon's ticks are all written in
 *  those shapes, so a descent that stopped at the first function boundary would
 *  see almost nothing. */
function callsIn(node) {
  const calls = [];
  const visit = (child) => {
    if (ts.isCallExpression(child)) calls.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return calls;
}

/**
 * The enclosing `serveProjection(...)` call this builder call is DEFERRED by, or
 * null.
 *
 * Being lexically inside the wrapper's argument list is not enough, and the
 * difference is the whole point of the wrapper. `serveProjection(kind,
 * directory, parameters, job, inline)` evaluates arguments one to four on the
 * request thread before it is entered; only the function literals are deferred.
 * A fold written as `serveProjection("overview", dir, buildLocalOverview(...),
 * job, inline)` runs exactly where the rule forbids it while looking wrapped, so
 * the check is that the call sits inside a function-literal ARGUMENT of the
 * wrapper, not merely inside its parentheses.
 */
function wrappedBy(call, name) {
  let child = call;
  let node = call.parent;
  while (node !== undefined) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      // `child` is the wrapper argument this call was reached through.
      const deferred =
        node.arguments.includes(child) &&
        (ts.isArrowFunction(child) || ts.isFunctionExpression(child));
      return deferred ? node : null;
    }
    child = node;
    node = node.parent;
  }
  return null;
}

function lineOf(tree, node) {
  return tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
}

/**
 * Walk outward from the declared entry points, recording every call to a
 * projection builder.
 *
 * The walk NEVER enters the builder module. That one rule earns its place
 * twice: it keeps the walk out of a four-thousand-line projection module, and
 * it stops the false positive where one builder calls another (
 * `buildLocalSessionOutcome` calls `buildLocalSessionOutcomeOnDatabase`) and a
 * builder calling a builder reads as a route folding inline.
 */
export function walkPlaneReach({ sourceRoot, read = defaultRead, entryPoints = ENTRY_POINTS }) {
  const indexes = new Map();
  const load = (relativePath) => {
    const hit = indexes.get(relativePath);
    if (hit !== undefined) return hit;
    const absolute = resolve(sourceRoot, relativePath);
    const source = read(absolute);
    if (source === null) return null;
    const index = moduleIndex(absolute, source);
    indexes.set(relativePath, index);
    return index;
  };

  const builderModule = load(BUILDER_MODULE);
  if (builderModule === null) {
    return { problems: [`${BUILDER_MODULE} is missing from ${SOURCE_ROOT}`] };
  }
  const builders = builderSet(read(resolve(sourceRoot, BUILDER_MODULE)), BUILDER_MODULE);

  const problems = [];
  const reached = new Set();
  const builderCalls = [];
  let unfollowedMemberCalls = 0;

  const queue = [];
  for (const entry of entryPoints) {
    const index = load(entry.module);
    if (index === null) {
      problems.push(`entry point module ${entry.module} is missing`);
      continue;
    }
    if (!index.declarations.has(entry.function)) {
      problems.push(
        `entry point ${entry.module}:${entry.function} no longer exists; the walk starts nowhere`,
      );
      continue;
    }
    queue.push({ module: entry.module, name: entry.function });
  }

  const visited = new Set();
  while (queue.length > 0) {
    const { module, name } = queue.pop();
    const identity = `${module}::${name}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    if (module === BUILDER_MODULE) continue;
    const index = load(module);
    if (index === null) continue;
    const declaration = index.declarations.get(name);
    if (declaration === undefined) continue;
    // Only once a declaration's calls are actually about to be scanned.
    reached.add(module);

    for (const call of callsIn(declaration)) {
      if (!ts.isIdentifier(call.expression)) {
        // `projection.buildLocalOverview(...)` through a namespace import is a
        // member call the walk CAN follow, because the namespace names a module
        // this gate already resolves. Without this, `import * as projection`
        // hid an inline window fold completely while the gate reported clean.
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          ts.isIdentifier(call.expression.expression)
        ) {
          const specifier = index.namespaces.get(call.expression.expression.text);
          const member = call.expression.name.text;
          if (specifier !== undefined) {
            const target = resolveRelativeModule(index.file, specifier);
            const targetRelative = target === null ? null : relative(sourceRoot, target);
            if (targetRelative === BUILDER_MODULE) {
              const builder = builders.get(member);
              if (builder !== undefined) {
                builderCalls.push({
                  builder: member,
                  budgeted: builder.budgeted,
                  windowed: builder.windowed,
                  module,
                  line: lineOf(index.tree, call),
                  wrapped: wrappedBy(call, WRAPPER) !== null,
                  rowBudget: rowBudgetArgument(call),
                });
              }
              continue;
            }
            if (targetRelative !== null) {
              queue.push({ module: targetRelative, name: member });
              continue;
            }
          }
        }
        if (ts.isPropertyAccessExpression(call.expression)) unfollowedMemberCalls += 1;
        continue;
      }
      const callee = call.expression.text;
      const imported = index.imports.get(callee);
      if (imported !== undefined) {
        const target = resolveRelativeModule(index.file, imported.specifier);
        if (target === null) continue;
        const targetRelative = relative(sourceRoot, target);
        if (targetRelative === BUILDER_MODULE) {
          const builder = builders.get(imported.importedName);
          if (builder !== undefined) {
            builderCalls.push({
              builder: imported.importedName,
              budgeted: builder.budgeted,
              windowed: builder.windowed,
              module,
              line: lineOf(index.tree, call),
              wrapped: wrappedBy(call, WRAPPER) !== null,
              rowBudget: rowBudgetArgument(call),
            });
          }
          continue;
        }
        queue.push({ module: targetRelative, name: imported.importedName });
        continue;
      }
      if (index.declarations.has(callee)) queue.push({ module, name: callee });
    }
  }

  // THE FLOOR IS ON WHAT THE WALK SAW, NOT ON WHICH FILES IT OPENED, and the
  // first draft had it on the latter, which cannot detect the failure it exists
  // for: `reached` was filled from the entry-point list before a single call was
  // inspected, so a walk that went blind the instant it started still reported
  // both floor modules reached. Counting builder call sites is the difference
  // between "the file was opened" and "the rules were applied to it".
  for (const floor of REACH_FLOOR) {
    const seen = builderCalls.filter((call) => call.module === floor.module).length;
    if (seen < floor.minBuilderCalls) {
      problems.push(
        `the walk found ${seen} projection builder call sites in ${floor.module}, below the floor of ${floor.minBuilderCalls}, so rule 1 and rule 2 have stopped covering it: ${floor.why}`,
      );
    }
  }

  return { problems, builders, builderCalls, reached, unfollowedMemberCalls };
}

function defaultRead(absolute) {
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

/**
 * How a call site supplies `rowBudget`.
 *
 * `bounded` IS THE SHAPE THE GATE CAN PROVE, never the shape it falls back to,
 * and the first draft had that backwards. It asked whether the token `null`
 * appeared in the initializer and called everything else bounded, which made
 * `rowBudget: undefined` a passing answer. `undefined` is byte-for-byte the
 * builder's default, so a one-token edit cleared the gate and changed nothing at
 * runtime. A gate with a one-token bypass is worse than none, because the bypass
 * looks like compliance in a diff.
 *
 * So only two shapes are bounded: a numeric literal, and an identifier that is
 * not `undefined`, which is how every real call site spells a named budget
 * constant. Everything else is reported. That includes a conditional, because
 * `binding.mode === "loopback" ? null : MAX` genuinely can be null, and a call
 * expression, because without a type checker this gate cannot know what
 * `budgetFor(binding)` returns and "I cannot tell" must not read as "fine".
 */
function rowBudgetArgument(call) {
  for (const argument of call.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      if (!ts.isIdentifier(key) || key.text !== "rowBudget") continue;
      return budgetShape(property.initializer);
    }
    // A spread can carry a budget this gate cannot see into. Say so rather than
    // reading the absence of a literal property as an absent budget.
    if (argument.properties.some((property) => ts.isSpreadAssignment(property))) {
      return "unprovable";
    }
  }
  return "absent";
}

function budgetShape(initializer) {
  if (ts.isNumericLiteral(initializer)) return "bounded";
  if (ts.isIdentifier(initializer)) {
    return initializer.text === "undefined" ? "absent" : "bounded";
  }
  if (initializer.kind === ts.SyntaxKind.NullKeyword) return "nullable";
  if (ts.isConditionalExpression(initializer)) {
    const whenTrue = budgetShape(initializer.whenTrue);
    const whenFalse = budgetShape(initializer.whenFalse);
    return whenTrue === "bounded" && whenFalse === "bounded" ? "bounded" : "nullable";
  }
  return "unprovable";
}

/* -------------------------------------------------------------------------- */
/* Rule 3: the daemon's ticks                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every `managedInterval` tick, keyed by the interval constant it is scheduled
 * on, with whether its handler refuses to overlap itself.
 *
 * The key is the interval identifier rather than a line number, because a line
 * number in an acceptance file is falsified by an unrelated edit above it and a
 * gate whose keys move is a gate whose file is always stale.
 *
 * GUARD DETECTION descends the WHOLE handler argument, not just its immediate
 * statements. Three of the five ticks are written as
 * `() => void (async () => { ... })()`, so the guard sits two function bodies
 * below the argument node. A test that only covered the flat `() => { ... }`
 * shape would pass while the gate reported every real tick as unguarded.
 */
export function daemonTicks(source, file = DAEMON_MODULE) {
  const tree = parseModule(source, file);
  const ticks = [];
  const problems = [];
  // A bare `setInterval` in the daemon is recurring work that rule 3 cannot see,
  // because it never passes through the one factory this gate reads. The
  // factory's own definition is the single legitimate use in this module. The
  // terminal has its own render loop and is deliberately out of scope: it is a
  // CLI process, not the thread that answers plane requests.
  const bareIntervals = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === INTERVAL_FACTORY
    ) {
      const [handler, every] = node.arguments;
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      if (every === undefined || !ts.isIdentifier(every)) {
        // Unnamed intervals cannot be keyed, so they cannot be declared, so they
        // cannot be excused. This is a problem rather than a finding.
        problems.push(
          `${DAEMON_MODULE}:${line} schedules a ${INTERVAL_FACTORY} on an expression rather than a named constant, so it cannot be keyed`,
        );
      } else {
        const guard = handler === undefined ? "unguarded" : hasReentrancyGuard(handler);
        ticks.push({ key: every.text, line, guard, guarded: guard === "guarded" });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "setInterval"
    ) {
      bareIntervals.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(tree, visit);
  // One is `managedInterval`'s own body. A second means recurring work escaped
  // the factory, and with it rule 3 entirely.
  if (bareIntervals.length > 1) {
    problems.push(
      `${DAEMON_MODULE} calls setInterval directly at line(s) ${bareIntervals.join(", ")}; recurring work must go through ${INTERVAL_FACTORY} so rule 3 can see it`,
    );
  }
  return { ticks, problems };
}

/**
 * The guard shape every tick in this file uses: a boolean the handler returns
 * early on, sets, and RELEASES.
 *
 * All THREE are required, and the release is the one the first draft forgot. A
 * flag that is tested and set but never set back to false is not a re-entrancy
 * guard, it is a run-once latch: the tick fires, takes the flag, and every
 * subsequent tick returns immediately for the life of the process. Capture
 * silently stops. That failure is strictly worse than the overlap the guard was
 * added to prevent, it is invisible in a diff that only adds two lines, and the
 * gate as first written called it compliant.
 *
 * RECOGNISED SHAPES, named here so the next author writes one on purpose rather
 * than discovering the list by failing:
 *
 *   if (busy) return;            busy = true;    ... busy = false;
 *   if (busy) { return; }        busy = true;    ... busy = false;
 *   if (busy) return undefined;  busy = true;    ... busy = false;
 *
 * The release may sit anywhere in the handler, including a `finally` block or a
 * promise `.finally()` callback, which is where four of the five real ticks put
 * it. The search descends the whole handler for the reason the tick shapes
 * demand: three of them are written `() => void (async () => { ... })()`, so
 * every part of the guard is two function bodies below the argument node.
 */
function hasReentrancyGuard(handler) {
  const tested = new Set();
  const taken = new Set();
  const released = new Set();
  const visit = (node) => {
    if (
      ts.isIfStatement(node) &&
      ts.isIdentifier(node.expression) &&
      isBareReturn(node.thenStatement)
    ) {
      tested.add(node.expression.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      if (node.right.kind === ts.SyntaxKind.TrueKeyword) taken.add(node.left.text);
      if (node.right.kind === ts.SyntaxKind.FalseKeyword) released.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);
  for (const flag of tested) {
    if (taken.has(flag) && released.has(flag)) return "guarded";
    if (taken.has(flag)) return "never-released";
  }
  return "unguarded";
}

/** `return;` and `return undefined;` are the same statement, and a guard should
 *  not fail the gate over which one its author typed. */
function isBareReturn(statement) {
  if (ts.isReturnStatement(statement)) {
    return (
      statement.expression === undefined ||
      (ts.isIdentifier(statement.expression) && statement.expression.text === "undefined")
    );
  }
  if (ts.isBlock(statement)) {
    return (
      statement.statements.length === 1 && isBareReturn(statement.statements[0])
    );
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Findings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn the three rules' observations into keyed findings.
 *
 * A key is stable under unrelated edits: it names the module and the symbol, and
 * never a line number. `detail` carries the line so the reader can go there.
 */
const BUDGET_DETAIL = {
  absent: (call) =>
    `${call.module}:${call.line} calls ${call.builder} with no rowBudget property at all, so the builder's null default applies and the read is unbounded`,
  nullable: (call) =>
    `${call.module}:${call.line} can pass rowBudget: null to ${call.builder}, which is an unbounded read`,
  unprovable: (call) =>
    `${call.module}:${call.line} passes a rowBudget to ${call.builder} that this gate cannot prove is a number, so it cannot tell a bound from an unbounded read`,
};

export function planeWorkFindings({ reach, ticks, declaredTicks }) {
  const findings = [];

  for (const call of reach.builderCalls) {
    if (call.windowed && !call.wrapped) {
      findings.push({
        key: `inline-fold::${call.module}::${call.builder}`,
        detail: `${call.module}:${call.line} folds a window through ${call.builder} without going through ${WRAPPER}, so the fold runs on the thread that answers requests`,
      });
    }
    if (call.budgeted && call.rowBudget !== "bounded") {
      // THE SHAPE IS IN THE KEY, not only in the detail. Keyed on
      // module::builder alone, a site that regressed from `nullable` to `absent`
      // matched the standing acceptance entry and stayed green, so the gate
      // excused a strictly worse shape than the one anyone had agreed to.
      findings.push({
        key: `unbounded-read::${call.module}::${call.builder}::${call.rowBudget}`,
        detail: BUDGET_DETAIL[call.rowBudget](call),
      });
    }
  }

  const declared = new Map(declaredTicks.map((tick) => [tick.key, tick]));
  for (const tick of ticks) {
    if (tick.guard === "unguarded") {
      findings.push({
        key: `unguarded-tick::${tick.key}`,
        detail: `${DAEMON_MODULE}:${tick.line} schedules work on ${tick.key} with no re-entrancy guard, so a tick that outlasts its interval runs beside itself`,
      });
    }
    if (tick.guard === "never-released") {
      findings.push({
        key: `latched-tick::${tick.key}`,
        detail: `${DAEMON_MODULE}:${tick.line} takes a guard on ${tick.key} and never sets it back to false, so the tick runs once and every later one returns immediately for the life of the process`,
      });
    }
    if (!declared.has(tick.key)) {
      findings.push({
        key: `unclassified-tick::${tick.key}`,
        detail: `${DAEMON_MODULE}:${tick.line} runs on ${tick.key}, which the acceptance file's ticks table does not classify; say whether its work needs a time budget and why`,
      });
    }
  }

  return findings.sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * The `ticks` table is the declared half of rule 3, and it is reconciled the
 * same way the acceptance entries are: a tick nobody classified is a finding,
 * and a classification for a tick that no longer exists is stale.
 */
export function staleTickDeclarations(ticks, declaredTicks) {
  const live = new Set(ticks.map((tick) => tick.key));
  return declaredTicks.filter((tick) => !live.has(tick.key));
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function checkPlaneWork(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? REPO_ROOT;
  const sourceRoot = resolve(repositoryRoot, SOURCE_ROOT);
  const read =
    options.read ??
    ((absolute) => (existsSync(absolute) ? readFileSync(absolute, "utf8") : null));

  const reach = walkPlaneReach({ sourceRoot, read });
  const problems = [...(reach.problems ?? [])];

  const daemonSource = read(resolve(sourceRoot, DAEMON_MODULE));
  let ticks = [];
  if (daemonSource === null) {
    problems.push(`${DAEMON_MODULE} is missing from ${SOURCE_ROOT}`);
  } else {
    const scanned = daemonTicks(daemonSource);
    ticks = scanned.ticks;
    problems.push(...scanned.problems);
  }

  const acceptance = readAcceptance(repositoryRoot, ACCEPTANCE_PATH);
  problems.push(...acceptance.problems);
  const declaredTicks = readDeclaredTicks(repositoryRoot, options.acceptanceDocument);
  problems.push(...declaredTicks.problems);

  const findings = planeWorkFindings({ reach, ticks, declaredTicks: declaredTicks.ticks });
  const reconciliation = reconcile(findings, acceptance.entries, CHECK_ID);
  for (const stale of staleTickDeclarations(ticks, declaredTicks.ticks)) {
    problems.push(
      `${ACCEPTANCE_PATH} classifies a tick on ${stale.key}, which the daemon no longer schedules; remove it`,
    );
  }

  return {
    problems,
    findings,
    reconciliation,
    ticks,
    reach,
    exitCode: exitCodeFor({
      problems,
      reconciliation,
      strict: options.strict === true,
    }),
  };
}

function readDeclaredTicks(repositoryRoot, provided) {
  const absolute = resolve(repositoryRoot, ACCEPTANCE_PATH);
  let parsed = provided;
  if (parsed === undefined) {
    if (!existsSync(absolute)) return { ticks: [], problems: [] };
    try {
      parsed = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      return { ticks: [], problems: [] };
    }
  }
  if (!Array.isArray(parsed?.ticks)) {
    return { ticks: [], problems: [`${ACCEPTANCE_PATH} has no ticks array`] };
  }
  const problems = [];
  const ticks = [];
  for (const [index, tick] of parsed.ticks.entries()) {
    const missing = ["key", "timeBudget", "why"].filter(
      (field) => tick?.[field] === undefined || tick[field] === "",
    );
    if (missing.length > 0) {
      problems.push(`${ACCEPTANCE_PATH} ticks entry ${index} is missing ${missing.join(", ")}`);
      continue;
    }
    ticks.push(tick);
  }
  return { ticks, problems };
}

export function formatPlaneWork(result) {
  const lines = [];
  if (result.problems.length > 0) {
    lines.push(`Problems (${result.problems.length}):`);
    for (const problem of result.problems) lines.push(`  - ${problem}`);
    lines.push("");
  }
  lines.push(
    `Ticks: ${result.ticks.length} scheduled, ${
      result.ticks.filter((tick) => tick.guarded).length
    } re-entrancy guarded.`,
  );
  lines.push(
    `Reach: ${result.reach.reached?.size ?? 0} modules, ${
      result.reach.builderCalls?.length ?? 0
    } projection builder call sites, ${
      result.reach.unfollowedMemberCalls ?? 0
    } member calls the walk did not follow.`,
  );
  lines.push("");
  lines.push(...formatAcceptanceSection(result.reconciliation, false));
  return lines.join("\n");
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const result = checkPlaneWork({ strict: process.argv.includes("--strict") });
  const report = formatPlaneWork(result);
  if (result.exitCode === 0) {
    console.log(report);
    console.log("Local plane work: no undeclared inline folds, unbounded reads, or unguarded ticks.");
  } else {
    console.error(report);
    process.exitCode = 1;
  }
}

export const GATE_SOURCE = fileURLToPath(import.meta.url);
