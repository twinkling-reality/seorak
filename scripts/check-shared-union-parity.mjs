#!/usr/bin/env node

/**
 * EVERY READER OF A UNION MUST ACCEPT ALL OF IT, made testable.
 *
 * THE BUG THIS EXISTS FOR IS PROVEN, NOT HYPOTHETICAL. `SessionEndReason` has six
 * values. A zod enum in the web's developer-model schema listed four. The moment a
 * real session ended with `resume`, the unknown value failed the WHOLE-OBJECT parse,
 * the validator answered with an empty snapshot, and the Model pillar told a
 * developer with 185,000 events to "run your first agent sessions" — for weeks. A
 * zero-fill wearing an honest-empty's clothes, from one missing word.
 *
 * It survived because nothing could see it. The union is type-only, so there was no
 * runtime value to check the copy against. The schema is cast
 * `as unknown as z.ZodType<T>`, so TypeScript could not compare the enum to the type
 * it claims to validate. And the demo fixture SCRUBBED `resume` to `other` to match
 * the broken enum, so 987 web tests passed against a fixture shaped like the bug.
 *
 * `end-reason-parity.test.ts` now pins that one union. On the day this was written
 * there were 26 more zod enums in the web schemas alone and nothing over any of them.
 * A test per union does not scale and, worse, it does not FAIL to scale visibly: the
 * union added tomorrow simply has no test, and the suite stays green.
 *
 * ---------------------------------------------------------------------------
 * THE SUBJECT, WHICH IS DERIVED AND NEVER LISTED
 * ---------------------------------------------------------------------------
 *
 * Every TypeScript file in every workspace that constructs a closed zod value set —
 * `z.enum(…)`, `z.literal(…)`, or a `z.union([…])` whose every alternative is a
 * literal. THERE IS NO LIST OF UNION NAMES ANYWHERE IN THIS FILE, and that is the
 * design constraint rather than a stylistic one: a gate that must be edited when a
 * union is added is a gate that silently stops covering new ones, which is the same
 * defect as the missing test it replaces. Add a package, a schema file, a union, or
 * a field, and it is covered on the next run.
 *
 * ---------------------------------------------------------------------------
 * THE PAIRING
 * ---------------------------------------------------------------------------
 *
 * A value set is checked against THE CONTRACT TYPE AT ITS OWN POSITION. The walk
 * starts at a ROOT — a place the source ASSERTS that a schema validates a contract —
 * and descends the schema expression in lockstep with that type:
 *
 *   1. `const s: z.ZodType<T> = …`     the annotation is the assertion;
 *   2. `… as unknown as z.ZodType<T>`  the cast is the assertion, and it is also
 *      exactly what stops TypeScript from checking it — the reason the original
 *      bug was invisible is the reason this root exists;
 *   3. `schema.parse(x) as T` / `result.data as T` — the parse output is asserted
 *      to be the contract, so the schema claims to produce it.
 *
 * Descending means: `z.object({ a: … })` moves to property `a` of the contract,
 * `z.array(…)` to its element type, `z.record(…)` to its value type, a tuple to the
 * element at that index. `.optional()`, `.nullable()`, `.catch()`, `.default()`,
 * bounds, and metadata are transparent — they change nullability or annotation, never
 * the value set. A reference to another schema constant is followed, so a sub-schema
 * with no annotation of its own is still reached through whatever declares it.
 *
 * ONE ARM OF A UNION DESCRIBES ONE CONSTITUENT. An arm that fixes
 * `state: z.literal('observed')` is matched to the constituent whose `state` is
 * `'observed'`, by the literals the arm pins — `z.discriminatedUnion` and a plain
 * `z.union` of object schemas alike. Comparing an arm against the whole union
 * instead would report every OTHER arm's values as missing, and a gate that cries
 * wolf on correct code is a gate that gets an acceptance entry per arm and then
 * gets deleted.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR FINDINGS
 * ---------------------------------------------------------------------------
 *
 * NARROWED. The contract at this position is a closed set of literals and the value
 *   set rejects at least one of them. THIS IS THE BUG. A legal value fails the parse,
 *   and because zod fails the whole object, one cell of one ring takes a pillar down.
 *
 * STRAY. The value set accepts a member the closed contract has no room for. Not a
 *   parse failure, but the other direction of the same drift: the union shrank and a
 *   reader kept the old word.
 *
 * UNBOUNDED. The contract at this position is `string` or `number` — open — and the
 *   value set closes it. Nothing here is mirroring a union, so nothing can be
 *   compared; the schema is DEFINING the accepted set. Sometimes that is exactly
 *   right, and one such narrowing in this tree is a privacy guard whose whole job is
 *   to refuse a value the type allows. It still has to say so out loud, because
 *   "the contract is open" is also what a union looks like the day somebody widens it
 *   to `string`, and that day the comparison would stop happening in silence.
 *
 * UNPAIRED. No root binds this value set to any contract, and it publishes no type of
 *   its own. NOTHING HERE IS CHECKED, and that is reported as a failure rather than
 *   skipped. A gate that quietly drops what it cannot pair is the green-nothing this
 *   repository has already shipped three times; the only honest response to "I cannot
 *   check this" is to say so and make somebody write down why that is acceptable.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT A FINDING
 * ---------------------------------------------------------------------------
 *
 * SELF-DEFINING SCHEMAS. A schema whose type is published with `z.infer<typeof S>`
 * IS the union: there is no second declaration for it to be narrower than, and its
 * value set cannot drift from a copy that does not exist. This is proven from the
 * code, not assumed — and it only applies when NO contract root reaches the same
 * declaration, so a schema that is both asserted against a contract and inferred
 * from stays checked. `packages/types/src/push.ts` is the whole of this class today.
 *
 * A WIDER SCHEMA THAN ITS CONTRACT. `z.string()` where the contract is a union
 * accepts everything the contract can hold, which is all this gate asks. It is a
 * weaker runtime guard, and it is not this gate's subject.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE EVIDENCE IS WEAKER THAN THE CLAIM
 * ---------------------------------------------------------------------------
 *
 * Saying so is cheaper than discovering it later.
 *
 * `.transform` AND `.pipe` ARE WALKED THROUGH, with the contract type unchanged. The
 * justification is directional: a transform runs AFTER the parse, so its receiver is
 * what must accept the contract value, and stopping at it would have left three real
 * value sets in `usageAllowanceSchema` unchecked behind a `.filter`. But a transform
 * that MAPS values — parsing `'a'` and emitting `'alpha'` — has an input set and an
 * output set that legitimately differ, and this walk would compare the input against
 * the output and report both a narrowing and a stray. That failure is loud and lands
 * in the acceptance file with a reason. The alternative was silence, which is worse.
 *
 * A CONTRACT DECLARED `string` IS NOT COMPARED. `ToolCallEvent.toolName` is typed
 * `string` while its real vocabulary is `KnownToolName | "mcp" | "other"`; the schema
 * pins that vocabulary and the gate can see the pin but not the vocabulary, because
 * nothing in the source ties them. It reports the site as UNBOUNDED so the narrowing
 * is at least declared, and the acceptance entry names the change that would turn it
 * into an ordinary comparison. Closing this properly means narrowing the interface,
 * not teaching this script a union name.
 *
 * TWO SCHEMAS THAT COPY THE SAME VOCABULARY WITHOUT A SHARED TYPE ARE NOT COMPARED
 * TO EACH OTHER. `push.ts` writes `z.enum(["development", "production"])` and
 * `delivery-health.ts` declares `PushDeliveryEnvironment` with the same two values,
 * and no assertion connects them. This gate answers "does this reader accept its
 * contract", never "do these two lists agree"; the second question has no mechanical
 * subject that is not a list of names.
 *
 * ---------------------------------------------------------------------------
 * MODE
 * ---------------------------------------------------------------------------
 *
 * ENFORCEMENT IS THE DEFAULT, and there is no flag that turns it off, matching
 * `open-core:check` and `types-boundary:check`. An undeclared narrowing fails, a
 * declared one does not, and an acceptance entry that no longer matches a narrowing
 * fails too, so the file cannot outlive what it excuses.
 * `docs/reference/shared-union-acceptance.json` is the only escape hatch. `--census`
 * changes the OUTPUT to the full site-by-site pairing; it does not change the exit
 * code, because a reporting flag that also silences the gate is a way to wire a green
 * nothing into CI.
 *
 * IT SHIPPED ENFORCING ON DAY ONE, with one acceptance entry, because report mode is
 * only worth its cost when a placement is an open owner decision. There was none
 * here: the tree was already in parity on 71 paired value sets when this was written,
 * so enforcing cost nothing and deferring would have bought nothing but a second
 * chance to forget.
 *
 * A GREEN RUN MEANS EVERY READER ACCEPTS EVERY VALUE ITS CONTRACT CAN HOLD. It never
 * means a declared reason is still true — this script checks that a narrowing is
 * DECLARED, never that the declaration is honest. That is a reader's job, against the
 * code and the line citations each entry carries.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "dist-dashboard",
  "build",
  ".git",
  "coverage",
  "ios",
  "android",
  ".expo",
]);

const SHARED_PACKAGE_ROOT = "packages/types/";
const ACCEPTANCE_PATH = "docs/reference/shared-union-acceptance.json";
const ACCEPTANCE_SCHEMA_VERSION = 1;

/**
 * The four ways a value set can fail to accept its contract. Each is a code
 * shape, not a named union: `narrowed` rejects a member the contract allows,
 * `stray` accepts one it does not, `unbounded` closes a contract that was open,
 * and `unpaired` is a value set this definition cannot check at all.
 */
const CATEGORIES = Object.freeze(["narrowed", "stray", "unbounded", "unpaired"]);

function compilerOptions(repositoryRoot) {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: repositoryRoot,
    paths: {
      "@seorak/types": ["packages/types/src/index.ts"],
      "@seorak/types/*": ["packages/types/src/*.ts"],
    },
  };
}

/** Wrappers that change nullability, bounds, defaulting, or metadata — never the value set. */
const TRANSPARENT_METHODS = new Set([
  "optional",
  "nullable",
  "nullish",
  "catch",
  "default",
  "prefault",
  "describe",
  "readonly",
  "brand",
  "meta",
  "register",
  "refine",
  "superRefine",
  "check",
  "overwrite",
  "clone",
  "min",
  "max",
  "length",
  "strict",
  "strip",
  "passthrough",
  "loose",
  "nonempty",
]);

const SCHEMA_TYPE_NAMES = new Set(["ZodType", "ZodSchema", "Schema", "ZodMiniType"]);
const INFER_TYPE_NAMES = new Set(["infer", "output", "input", "TypeOf"]);

// ── file discovery ────────────────────────────────────────────────────────────

function walkDirectory(root, out) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walkDirectory(path, out);
      continue;
    }
    if (!entry.isFile() || path.endsWith(".d.ts")) continue;
    if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * THE SUBJECT IS DERIVED, NEVER LISTED. Every TypeScript file in every workspace
 * that constructs a closed zod value set.
 */
export function subjectFiles(repositoryRoot = REPO_ROOT) {
  const roots = [];
  for (const group of ["packages", "apps"]) {
    const groupRoot = resolve(repositoryRoot, group);
    if (!existsSync(groupRoot) || !statSync(groupRoot).isDirectory()) continue;
    for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue;
      roots.push(resolve(groupRoot, entry.name));
    }
  }
  return roots
    .flatMap((root) => walkDirectory(root, []))
    .filter((file) => /\bz\s*\.\s*(enum|literal|union)\s*\(/.test(readFileSync(file, "utf8")))
    .sort();
}

// ── syntax helpers ────────────────────────────────────────────────────────────

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function zodFactory(call) {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const receiver = unwrap(callee.expression);
  return ts.isIdentifier(receiver) && receiver.text === "z" ? callee.name.text : undefined;
}

function zodMethodCall(call) {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const receiver = unwrap(callee.expression);
  if (ts.isIdentifier(receiver) && receiver.text === "z") return undefined;
  return { method: callee.name.text, receiver };
}

function isValueSetCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const factory = zodFactory(node);
  return factory === "enum" || factory === "literal" || factory === "union";
}

/** `z.ZodType<T>` / `ZodType<T>` → the T type node. */
function schemaTypeArgument(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const name = ts.isQualifiedName(typeNode.typeName)
    ? typeNode.typeName.right.text
    : typeNode.typeName.text;
  if (!SCHEMA_TYPE_NAMES.has(name)) return undefined;
  return typeNode.typeArguments?.[0];
}

/** `z.infer<typeof S>` → the S expression. */
function inferOperand(typeNode) {
  if (!ts.isTypeReferenceNode(typeNode)) return undefined;
  const name = ts.isQualifiedName(typeNode.typeName)
    ? typeNode.typeName.right.text
    : typeNode.typeName.text;
  if (!INFER_TYPE_NAMES.has(name)) return undefined;
  const argument = typeNode.typeArguments?.[0];
  if (!argument || !ts.isTypeQueryNode(argument)) return undefined;
  return argument.exprName;
}

function literalValue(node) {
  if (!node) return undefined;
  const inner = unwrap(node);
  if (ts.isStringLiteralLike(inner)) return inner.text;
  if (ts.isNumericLiteral(inner)) return Number(inner.text);
  if (
    ts.isPrefixUnaryExpression(inner) &&
    inner.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(inner.operand)
  ) {
    return -Number(inner.operand.text);
  }
  if (inner.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (inner.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function propertyName(property) {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

// ── type helpers ──────────────────────────────────────────────────────────────

function constituents(type) {
  return type.isUnion() ? type.types.flatMap(constituents) : [type];
}

const NULLISH_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;

function stripNullish(types) {
  return types.flatMap(constituents).filter((type) => (type.flags & NULLISH_FLAGS) === 0);
}

/**
 * `getTypeOfSymbol`, not `getTypeOfSymbolAtLocation`: a `Record<K, V>` property
 * has no declaration node, and requiring one silently dropped every contract
 * written as a mapped type.
 */
function propertyTypes(checker, types, name) {
  const out = [];
  for (const type of stripNullish(types)) {
    const symbol = checker.getPropertyOfType(type, name);
    if (!symbol) continue;
    out.push(checker.getTypeOfSymbol(symbol));
  }
  return out;
}

function elementTypes(checker, types) {
  const out = [];
  for (const type of stripNullish(types)) {
    const number = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (number) {
      out.push(number);
      continue;
    }
    const args = checker.getTypeArguments?.(type) ?? [];
    if (args.length === 1) out.push(args[0]);
  }
  return out;
}

function valueTypes(checker, types) {
  const out = [];
  for (const type of stripNullish(types)) {
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    if (index) {
      out.push(index);
      continue;
    }
    const args = checker.getTypeArguments?.(type) ?? [];
    if (args.length === 2) out.push(args[1]);
    else {
      // A record written as an object type: every property shares the value shape.
      for (const property of checker.getPropertiesOfType(type)) {
        out.push(checker.getTypeOfSymbol(property));
      }
    }
  }
  return out;
}

function tupleElementTypes(checker, types, index) {
  const out = [];
  for (const type of stripNullish(types)) {
    const args = checker.getTypeArguments?.(type) ?? [];
    if (args.length > index) out.push(args[index]);
    else {
      const number = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (number) out.push(number);
    }
  }
  return out;
}

/**
 * The set of values a contract position allows.
 *   closed     — a finite set of literals; a schema here MUST accept all of them.
 *   open       — `string` or `number` reaches the position, so the schema is
 *                DEFINING a set rather than mirroring one.
 *   unresolved — nothing readable (`any`, a type the walk could not follow).
 */
function contractMembers(types) {
  const flat = stripNullish(types);
  if (flat.length === 0) return { kind: "unresolved", members: new Set() };
  const members = new Set();
  let open = false;
  let opaque = false;
  for (const type of flat) {
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
      members.add(type.value);
    } else if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      members.add(type.value);
    } else if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      members.add(type.intrinsicName === "true");
    } else if ((type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) !== 0) {
      open = true;
    } else if (
      type.isIntersection?.() &&
      type.types.some((part) => (part.flags & ts.TypeFlags.String) !== 0)
    ) {
      // `(string & {})` — the open half of an extensible union such as AgentId.
      open = true;
    } else {
      opaque = true;
    }
  }
  if (open) return { kind: "open", members };
  if (members.size > 0 && !opaque) return { kind: "closed", members };
  return { kind: "unresolved", members };
}

/** Names the contract's own value set, so a failure can say WHICH union it broke. */
function contractOrigin(checker, types, repositoryRoot) {
  const names = new Set();
  const files = new Set();
  for (const type of types) {
    const bare = checker.getNonNullableType(type);
    const symbol = bare.aliasSymbol ?? type.aliasSymbol;
    if (!symbol) continue;
    names.add(symbol.getName());
    for (const declaration of symbol.getDeclarations() ?? []) {
      files.add(
        relative(repositoryRoot, declaration.getSourceFile().fileName).split(sep).join("/"),
      );
    }
  }
  return { names: [...names].sort(), files: [...files].sort() };
}

/** Members of `z.enum(SOME_CONST)` — the const's element type, not the tuple. */
function constMembers(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  const candidates = [];
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  if (element) candidates.push(element);
  for (const argument of checker.getTypeArguments?.(type) ?? []) candidates.push(argument);
  if (candidates.length === 0) candidates.push(type);
  const resolved = contractMembers(candidates);
  return resolved.kind === "closed" ? [...resolved.members] : undefined;
}

// ── the descent ───────────────────────────────────────────────────────────────

/**
 * Walk a zod schema in lockstep with the contract type it claims to validate,
 * recording every closed value set the walk reaches together with the contract
 * at that position.
 */
function makeWalker(checker, file, repositoryRoot) {
  const path = relative(repositoryRoot, file.fileName).split(sep).join("/");
  const sites = new Map();
  const touchedDeclarations = new Set();
  const visited = new Set();

  const record = (node, declared, types, kind, memberSource, scope) => {
    if (sites.has(node)) return;
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    sites.set(node, {
      file: path,
      line: line + 1,
      kind,
      memberSource,
      symbol: scope.symbol,
      field: scope.trail,
      declared,
      types,
    });
  };

  const visit = (expression, types, scope) => {
    const expr = unwrap(expression);

    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      const target = resolveSchemaDeclaration(checker, expr);
      if (!target) return;
      touchedDeclarations.add(target);
      const key = `${target.getSourceFile().fileName}:${target.pos}`;
      if (visited.has(key)) return;
      visited.add(key);
      const name = ts.isIdentifier(target.name) ? target.name.text : scope.symbol;
      visit(target.initializer, types, { symbol: name, trail: "" });
      visited.delete(key);
      return;
    }

    if (!ts.isCallExpression(expr)) return;

    const factory = zodFactory(expr);
    if (factory !== undefined) {
      visitFactory(expr, factory, types, scope);
      return;
    }

    const method = zodMethodCall(expr);
    if (!method) return;
    if (TRANSPARENT_METHODS.has(method.method)) {
      visit(method.receiver, types, scope);
      return;
    }
    if (method.method === "extend" || method.method === "merge") {
      visit(method.receiver, types, scope);
      const argument = expr.arguments[0] ? unwrap(expr.arguments[0]) : undefined;
      if (argument && ts.isObjectLiteralExpression(argument)) visitObjectBody(argument, types, scope);
      else if (argument) visit(argument, types, scope);
      return;
    }
    if (method.method === "array") {
      visit(method.receiver, elementTypes(checker, types), step(scope, "[]"));
      return;
    }
    if (method.method === "and" || method.method === "or") {
      visit(method.receiver, types, scope);
      for (const argument of expr.arguments) visit(argument, types, scope);
      return;
    }
    if (method.method === "omit" || method.method === "pick" || method.method === "partial") {
      visit(method.receiver, types, scope);
      return;
    }
    if (method.method === "transform" || method.method === "pipe") {
      // A transform runs AFTER the parse, so its receiver is what must accept the
      // contract value. See the "WHERE THE EVIDENCE IS WEAKER" note in the header.
      visit(method.receiver, types, scope);
      if (method.method === "pipe" && expr.arguments[0]) {
        visit(expr.arguments[0], types, scope);
      }
      return;
    }
  };

  const step = (scope, suffix) => ({ symbol: scope.symbol, trail: `${scope.trail}${suffix}` });

  const visitObjectBody = (literal, types, scope) => {
    for (const property of literal.properties) {
      if (ts.isSpreadAssignment(property)) {
        visit(property.expression, types, scope);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property);
      if (name === undefined) continue;
      visit(
        property.initializer,
        propertyTypes(checker, types, name),
        step(scope, `.${name}`),
      );
    }
  };

  /** Every alternative a literal? Then the union IS one closed value set. */
  const literalUnionMembers = (argument) => {
    const inner = argument ? unwrap(argument) : undefined;
    if (!inner || !ts.isArrayLiteralExpression(inner) || inner.elements.length === 0) {
      return undefined;
    }
    const members = [];
    for (const element of inner.elements) {
      const alternative = unwrap(element);
      if (!ts.isCallExpression(alternative) || zodFactory(alternative) !== "literal") {
        return undefined;
      }
      const value = literalValue(alternative.arguments[0]);
      if (value === undefined) return undefined;
      members.push(value);
    }
    return members;
  };

  const visitFactory = (call, factory, types, scope) => {
    const args = call.arguments;
    switch (factory) {
      case "enum": {
        const argument = args[0];
        if (!argument) return;
        const inner = unwrap(argument);
        if (ts.isArrayLiteralExpression(inner)) {
          const members = inner.elements.map((element) => literalValue(element));
          if (members.some((member) => member === undefined)) {
            record(call, [], types, "enum", "unreadable", scope);
            return;
          }
          record(call, members, types, "enum", "inline", scope);
          return;
        }
        // `z.enum(SHARED_CONST)` — the members ARE the union's own runtime array,
        // so this pairing cannot drift. Read them anyway and check it.
        const members = constMembers(checker, inner);
        record(
          call,
          members ?? [],
          types,
          "enum",
          members === undefined
            ? "unreadable"
            : ts.isIdentifier(inner)
              ? `const ${inner.text}`
              : "const expression",
          scope,
        );
        return;
      }
      case "literal": {
        const argument = args[0];
        if (!argument) return;
        const value = literalValue(argument);
        if (value !== undefined) {
          record(call, [value], types, "literal", "inline", scope);
          return;
        }
        const inner = unwrap(argument);
        const members = constMembers(checker, inner);
        record(
          call,
          members ?? [],
          types,
          "literal",
          members === undefined
            ? "unreadable"
            : ts.isIdentifier(inner)
              ? `const ${inner.text}`
              : "const expression",
          scope,
        );
        return;
      }
      case "object":
      case "strictObject":
      case "looseObject": {
        const argument = args[0] ? unwrap(args[0]) : undefined;
        if (argument && ts.isObjectLiteralExpression(argument)) {
          visitObjectBody(argument, types, scope);
        } else if (argument) {
          visit(argument, types, scope);
        }
        return;
      }
      case "array":
      case "set": {
        if (args[0]) visit(args[0], elementTypes(checker, types), step(scope, "[]"));
        return;
      }
      case "record": {
        const value = args[args.length - 1];
        if (value) visit(value, valueTypes(checker, types), step(scope, "[*]"));
        return;
      }
      case "map": {
        if (args[1]) visit(args[1], valueTypes(checker, types), step(scope, "[*]"));
        return;
      }
      case "tuple": {
        const inner = args[0] ? unwrap(args[0]) : undefined;
        if (inner && ts.isArrayLiteralExpression(inner)) {
          inner.elements.forEach((element, index) => {
            visit(element, tupleElementTypes(checker, types, index), step(scope, `[${index}]`));
          });
        }
        return;
      }
      case "union": {
        const members = literalUnionMembers(args[0]);
        if (members) {
          record(call, members, types, "union-of-literals", "inline", scope);
          return;
        }
        const inner = args[0] ? unwrap(args[0]) : undefined;
        if (!inner || !ts.isArrayLiteralExpression(inner)) return;
        for (const element of inner.elements) {
          visit(element, narrowToArm(types, element) ?? types, scope);
        }
        return;
      }
      case "discriminatedUnion": {
        const inner = args[1] ? unwrap(args[1]) : undefined;
        if (!inner || !ts.isArrayLiteralExpression(inner)) return;
        for (const element of inner.elements) {
          visit(element, narrowToArm(types, element) ?? types, scope);
        }
        return;
      }
      case "intersection": {
        for (const argument of args) visit(argument, types, scope);
        return;
      }
      case "lazy": {
        const inner = args[0] ? unwrap(args[0]) : undefined;
        if (inner && ts.isArrowFunction(inner) && !ts.isBlock(inner.body)) {
          visit(inner.body, types, scope);
        }
        return;
      }
      case "preprocess": {
        if (args[1]) visit(args[1], types, scope);
        return;
      }
      case "pipe": {
        for (const argument of args) visit(argument, types, scope);
        return;
      }
      case "optional":
      case "nullable":
      case "nullish":
      case "readonly": {
        if (args[0]) visit(args[0], types, scope);
        return;
      }
      default:
        return;
    }
  };

  /**
   * ONE ARM OF A UNION DESCRIBES ONE CONSTITUENT. Match them by the literals the
   * arm pins: an arm that fixes `state: z.literal('observed')` is the constituent
   * whose `state` is `'observed'`, and comparing it against the whole union would
   * report every other arm's values as missing.
   */
  const narrowToArm = (types, armExpression) => {
    const pinned = pinnedLiterals(armExpression);
    if (pinned.size === 0) return undefined;
    const flat = stripNullish(types);
    if (flat.length < 2) return undefined;
    const matches = flat.filter((type) =>
      [...pinned].every(([key, value]) => {
        const symbol = checker.getPropertyOfType(type, key);
        if (!symbol) return false;
        return constituents(checker.getTypeOfSymbol(symbol)).some(
          (part) =>
            (part.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) !== 0 &&
            part.value === value,
        );
      }),
    );
    return matches.length > 0 && matches.length < flat.length ? matches : undefined;
  };

  /** Top-level properties an object schema pins to a single literal. */
  const pinnedLiterals = (expression, depth = 0, out = new Map()) => {
    if (depth > 8) return out;
    const expr = unwrap(expression);
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      const target = resolveSchemaDeclaration(checker, expr);
      if (target) pinnedLiterals(target.initializer, depth + 1, out);
      return out;
    }
    if (!ts.isCallExpression(expr)) return out;
    const factory = zodFactory(expr);
    if (factory === "object" || factory === "strictObject" || factory === "looseObject") {
      const argument = expr.arguments[0] ? unwrap(expr.arguments[0]) : undefined;
      if (!argument || !ts.isObjectLiteralExpression(argument)) return out;
      for (const property of argument.properties) {
        if (ts.isSpreadAssignment(property)) {
          pinnedLiterals(property.expression, depth + 1, out);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property);
        if (name === undefined) continue;
        const initializer = unwrap(property.initializer);
        if (!ts.isCallExpression(initializer) || zodFactory(initializer) !== "literal") continue;
        const direct = literalValue(initializer.arguments[0]);
        if (direct !== undefined) {
          out.set(name, direct);
          continue;
        }
        const members = constMembers(checker, unwrap(initializer.arguments[0]));
        if (members && members.length === 1) out.set(name, members[0]);
      }
      return out;
    }
    const method = zodMethodCall(expr);
    if (method && (TRANSPARENT_METHODS.has(method.method) || method.method === "extend")) {
      pinnedLiterals(method.receiver, depth + 1, out);
      if (method.method === "extend" && expr.arguments[0]) {
        const argument = unwrap(expr.arguments[0]);
        if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const name = propertyName(property);
            const initializer = unwrap(property.initializer);
            if (
              name !== undefined &&
              ts.isCallExpression(initializer) &&
              zodFactory(initializer) === "literal"
            ) {
              const value = literalValue(initializer.arguments[0]);
              if (value !== undefined) out.set(name, value);
            }
          }
        }
      }
      return out;
    }
    // `targetSchema("apnsDevice")` — a factory that pins the discriminant from its
    // own argument. Read the pin off the returned object literal's parameter use.
    if (ts.isIdentifier(unwrap(expr.expression))) {
      const declaration = resolveFunctionDeclaration(checker, unwrap(expr.expression));
      if (declaration) {
        const returned = returnedExpression(declaration);
        if (returned) {
          const inner = pinnedLiterals(returned, depth + 1, new Map());
          for (const [key, value] of inner) out.set(key, value);
          for (const [key, value] of parameterPins(declaration, expr, returned)) out.set(key, value);
        }
      }
    }
    return out;
  };

  /** `tokenKind: z.literal(kind)` where `kind` is a parameter — read the call's argument. */
  const parameterPins = (declaration, call, returned) => {
    const pins = new Map();
    const names = declaration.parameters.map((parameter) =>
      ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
    );
    const scan = (node) => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isCallExpression(unwrap(node.initializer)) &&
        zodFactory(unwrap(node.initializer)) === "literal"
      ) {
        const argument = unwrap(unwrap(node.initializer).arguments[0] ?? node);
        const name = propertyName(node);
        if (name !== undefined && ts.isIdentifier(argument)) {
          const index = names.indexOf(argument.text);
          if (index >= 0) {
            const value = literalValue(call.arguments[index]);
            if (value !== undefined) pins.set(name, value);
          }
        }
      }
      ts.forEachChild(node, scan);
    };
    scan(returned);
    return pins;
  };

  return { visit, sites, touchedDeclarations, path };
}

function resolveSchemaDeclaration(checker, expression) {
  const symbol = checker.getSymbolAtLocation(expression);
  const target =
    symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) return declaration;
  }
  return undefined;
}

function resolveFunctionDeclaration(checker, expression) {
  const symbol = checker.getSymbolAtLocation(expression);
  const target =
    symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    if (ts.isFunctionDeclaration(declaration) && declaration.body) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrap(declaration.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return initializer;
      }
    }
  }
  return undefined;
}

function returnedExpression(declaration) {
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) return declaration.body;
  let found;
  const scan = (node) => {
    if (found) return;
    if (ts.isReturnStatement(node) && node.expression) {
      found = node.expression;
      return;
    }
    ts.forEachChild(node, scan);
  };
  if (declaration.body) scan(declaration.body);
  return found;
}

// ── roots ─────────────────────────────────────────────────────────────────────

/**
 * A CONTRACT ROOT is any place the source ASSERTS that a zod schema validates a
 * contract type. Three shapes, all read from the code:
 *   1. `const s: z.ZodType<T> = …`      — the annotation is the assertion.
 *   2. `… as unknown as z.ZodType<T>`   — the cast is the assertion, and it is
 *      also precisely what stops TypeScript from checking it.
 *   3. `schema.parse(x) as T`, `result.data as T` — the parse output is asserted
 *      to be the contract, so the schema claims to produce it.
 */
function contractRoots(file, checker) {
  const roots = [];
  const add = (expression, typeNode) => {
    const argument = schemaTypeArgument(typeNode);
    if (!argument) return;
    roots.push({ expression, type: checker.getTypeFromTypeNode(argument) });
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) add(node.initializer, node.type);
    if (ts.isAsExpression(node)) {
      add(node.expression, node.type);
      const schema = parseResultSchema(checker, node.expression);
      if (schema) roots.push({ expression: schema, type: checker.getTypeFromTypeNode(node.type) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return roots;
}

/** `X.parse(v)` or `X.safeParse(v).data` — returns the expression naming X. */
function parseResultSchema(checker, expression, depth = 0) {
  if (depth > 4) return undefined;
  const expr = unwrap(expression);
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "data") {
    return parseResultSchema(checker, expr.expression, depth + 1);
  }
  if (ts.isIdentifier(expr)) {
    const declaration = resolveSchemaDeclaration(checker, expr);
    return declaration ? parseResultSchema(checker, declaration.initializer, depth + 1) : undefined;
  }
  if (!ts.isCallExpression(expr)) return undefined;
  const callee = unwrap(expr.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text !== "parse" && callee.name.text !== "safeParse") return undefined;
  return callee.expression;
}

/**
 * A SELF-DEFINING schema publishes its own type with `z.infer<typeof S>`. There
 * is no second declaration for it to be narrower than: the schema IS the union.
 * Only counts when no contract root reaches the same declaration, so a schema
 * that is BOTH asserted against a contract and inferred from stays checked.
 */
function inferRoots(file, checker) {
  const roots = [];
  const visit = (node) => {
    if (ts.isTypeReferenceNode(node)) {
      const operand = inferOperand(node);
      if (operand) {
        const declaration = resolveSchemaDeclaration(checker, operand);
        if (declaration) roots.push(declaration);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return roots;
}

/**
 * Every value set syntactically reachable from a schema expression, following
 * references into the schema constants it is built from. No types involved: this
 * answers "is this value set part of that schema", not "what does it validate".
 */
function reachableValueSets(checker, expression, out = new Set(), seen = new Set()) {
  const walk = (node) => {
    if (ts.isIdentifier(node)) {
      // A schema built by a helper — `targetSchema("apnsDevice")` — carries its
      // value sets in the helper's body, so the walk follows functions too.
      const target =
        resolveSchemaDeclaration(checker, node) ?? resolveFunctionDeclaration(checker, node);
      if (!target) return;
      const key = `${target.getSourceFile().fileName}:${target.pos}`;
      if (seen.has(key)) return;
      seen.add(key);
      walk(ts.isVariableDeclaration(target) ? target.initializer : target);
      return;
    }
    if (isValueSetCall(node)) out.add(node);
    ts.forEachChild(node, walk);
  };
  walk(expression);
  return out;
}

// ── analysis ──────────────────────────────────────────────────────────────────

export function analyzeUnionParity(repositoryRoot = REPO_ROOT, files = undefined) {
  const fileNames = files ?? subjectFiles(repositoryRoot);
  const program = ts.createProgram(fileNames, compilerOptions(repositoryRoot));
  const checker = program.getTypeChecker();

  const census = [];
  const findings = [];

  for (const fileName of fileNames) {
    const file = program.getSourceFile(fileName);
    if (!file) continue;
    const path = relative(repositoryRoot, fileName).split(sep).join("/");
    const walker = makeWalker(checker, file, repositoryRoot);
    for (const root of contractRoots(file, checker)) {
      walker.visit(root.expression, [root.type], { symbol: undefined, trail: "" });
    }

    const selfDefined = new Set();
    for (const declaration of inferRoots(file, checker)) {
      if (walker.touchedDeclarations.has(declaration)) continue;
      for (const node of reachableValueSets(checker, declaration.initializer)) {
        selfDefined.add(node);
      }
    }

    const all = [];
    const collect = (node) => {
      if (isValueSetCall(node)) all.push(node);
      ts.forEachChild(node, collect);
    };
    collect(file);

    for (const node of all) {
      const factory = zodFactory(node);
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      const site = walker.sites.get(node);

      if (!site) {
        // A `z.union` of schemas is a container the walk descends through, not a
        // value set; only an all-literal union is one.
        if (factory === "union") {
          const inner = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
          const literalOnly =
            inner &&
            ts.isArrayLiteralExpression(inner) &&
            inner.elements.length > 0 &&
            inner.elements.every((element) => {
              const alternative = unwrap(element);
              return ts.isCallExpression(alternative) && zodFactory(alternative) === "literal";
            });
          if (!literalOnly) continue;
        }
        // A literal INSIDE a value set the walk recorded is not its own site.
        if (factory === "literal") {
          let parent = node.parent;
          let inside = false;
          while (parent && !inside) {
            if (walker.sites.has(parent)) inside = true;
            parent = parent.parent;
          }
          if (inside) continue;
        }
        const record = {
          file: path,
          line: line + 1,
          kind: factory === "union" ? "union-of-literals" : factory,
          status: selfDefined.has(node) ? "self-defined" : "unpaired",
          symbol: enclosingSchemaName(node) ?? "<anonymous>",
          field: "",
          declared: [],
        };
        census.push(record);
        if (record.status === "unpaired") {
          findings.push({
            file: record.file,
            symbol: record.symbol,
            field: record.field,
            category: "unpaired",
            line: record.line,
            evidence:
              "no contract type is asserted over this value set and it publishes no type of its own, so nothing here is checked",
          });
        }
        continue;
      }

      const contract = contractMembers(site.types);
      const origin = contractOrigin(checker, site.types, repositoryRoot);
      const declared = new Set(site.declared);
      const missing =
        contract.kind === "closed"
          ? [...contract.members].filter((member) => !declared.has(member))
          : [];
      const stray =
        contract.kind === "closed"
          ? [...declared].filter((member) => !contract.members.has(member))
          : [];
      const union = origin.names.join(" | ") || "<inline>";
      const record = {
        file: site.file,
        line: site.line,
        kind: site.kind,
        memberSource: site.memberSource,
        symbol: site.symbol ?? enclosingSchemaName(node) ?? "<anonymous>",
        field: site.field,
        status: contract.kind,
        union,
        unionFiles: origin.files,
        shared: origin.files.some((file) => file.startsWith(SHARED_PACKAGE_ROOT)),
        declared: [...declared].map(String).sort(),
        contract: [...contract.members].map(String).sort(),
        missing: missing.map(String).sort(),
        stray: stray.map(String).sort(),
      };
      census.push(record);

      const at = { file: record.file, symbol: record.symbol, field: record.field, line: record.line };
      if (record.missing.length > 0) {
        findings.push({
          ...at,
          category: "narrowed",
          evidence: `${union} allows ${record.contract.length} values and this accepts ${record.declared.length}; it rejects ${record.missing.join(", ")}`,
        });
      }
      if (record.stray.length > 0) {
        findings.push({
          ...at,
          category: "stray",
          evidence: `${union} has no room for ${record.stray.join(", ")}`,
        });
      }
      if (record.status === "open") {
        findings.push({
          ...at,
          category: "unbounded",
          evidence: `the contract here accepts any ${site.kind === "literal" ? "value" : "string"}, and this pins it to ${record.declared.length}: ${record.declared.join(", ")}`,
        });
      }
      if (record.status === "unresolved") {
        findings.push({
          ...at,
          category: "unpaired",
          evidence:
            "the walk reached this value set but could not read the contract at its position, so nothing here is checked",
        });
      }
    }
  }

  const order = (left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line ||
    String(left.category ?? "").localeCompare(String(right.category ?? ""));
  census.sort(order);
  findings.sort(order);
  return {
    fileCount: fileNames.length,
    siteCount: census.length,
    checkedCount: census.filter((site) => site.status === "closed").length,
    sharedCount: census.filter((site) => site.status === "closed" && site.shared).length,
    selfDefinedCount: census.filter((site) => site.status === "self-defined").length,
    census,
    findings,
  };
}

function enclosingSchemaName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return undefined;
}


// ── acceptance ────────────────────────────────────────────────────────────────

export function readAcceptance(repositoryRoot = REPO_ROOT, path = ACCEPTANCE_PATH) {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) return { entries: [], problems: [`${path} is missing`] };
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
    if (typeof entry?.field !== "string") missing.push("field");
    if (missing.length > 0) {
      problems.push(`${path} entry ${index} is missing ${missing.sort().join(", ")}`);
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
  return `${entry.file}::${entry.symbol}::${entry.field}::${entry.category}`;
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

// ── report ────────────────────────────────────────────────────────────────────

function formatFinding(finding) {
  return `${finding.file}:${finding.line} ${finding.symbol}${finding.field} [${finding.category}] ${finding.evidence}`;
}

export function formatReport(analysis, reconciliation, acceptanceProblems) {
  const lines = [];
  lines.push(
    "Shared union parity (enforcing). Definition: scripts/check-shared-union-parity.mjs.",
  );
  lines.push(
    `Scanned ${analysis.fileCount} files that build a closed zod value set and found ${analysis.siteCount} of them.`,
  );
  lines.push(
    `${analysis.checkedCount} are bound to a closed contract and compared member by member; ${analysis.sharedCount} of those mirror a union declared in ${SHARED_PACKAGE_ROOT}.`,
  );
  lines.push(
    `${analysis.selfDefinedCount} publish their own type with \`z.infer\`, so they ARE the union and have nothing to be narrower than.`,
  );
  for (const problem of acceptanceProblems) lines.push(`! acceptance file: ${problem}`);

  const { accepted, undeclared, stale } = reconciliation;
  lines.push("");
  lines.push(`Accepted narrowings (${accepted.length}):`);
  for (const finding of accepted) {
    lines.push(`  - ${formatFinding(finding)}`);
    lines.push(
      `      accepted ${finding.acceptance.acceptedOn}; falsified when ${finding.acceptance.falsifiedWhen}`,
    );
  }
  lines.push("");
  lines.push(`Undeclared narrowings (${undeclared.length}):`);
  for (const finding of undeclared) lines.push(`  - ${formatFinding(finding)}`);
  if (stale.length > 0) {
    lines.push("");
    lines.push(`Acceptance entries with no matching narrowing (${stale.length}):`);
    for (const entry of stale) {
      lines.push(
        `  - ${entry.file} ${entry.symbol}${entry.field} [${entry.category}] is falsified, remove it`,
      );
    }
  }
  lines.push("");
  lines.push(
    `An undeclared narrowing fails this check, and so does an acceptance entry whose narrowing is gone. ${ACCEPTANCE_PATH} is the only escape hatch, and no flag disables enforcement. A green run means every reader accepts every value its contract can hold; it does NOT mean a declared reason is still true, which is a reader's job against the code.`,
  );
  return lines.join("\n");
}

export function checkSharedUnionParity(repositoryRoot = REPO_ROOT) {
  const analysis = analyzeUnionParity(repositoryRoot);
  const { entries, problems } = readAcceptance(repositoryRoot);
  return { analysis, reconciliation: reconcile(analysis.findings, entries), problems };
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  // `--root` exists so the test can drive this executable against a fixture
  // repository, including one with a deliberately planted narrowing.
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const { analysis, reconciliation, problems } = checkSharedUnionParity(
    rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT,
  );
  if (process.argv.includes("--census")) {
    console.log(JSON.stringify({ ...analysis, census: analysis.census }, null, 2));
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
