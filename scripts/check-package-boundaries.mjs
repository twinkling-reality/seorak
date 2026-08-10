#!/usr/bin/env node

/**
 * Per-workspace dependency and import policy for all nine workspaces.
 *
 * WHAT CHANGED IN B1a, and why the old shape could not scale. This gate used to
 * carry two hand-written policies and decide "is this an internal package?"
 * with a literal `@seorak/` prefix test. `apps/mobile` publishes as
 * `seorak-app`, which carries no prefix, so it escaped that test entirely: the
 * gate could not have seen a dependency edge into the mobile app. Both the
 * workspace list and each workspace's visibility now come from
 * `docs/reference/open-core-ownership.json`, so a tenth workspace is a data
 * edit and the internal-package question is answered by identity rather than by
 * spelling.
 *
 * Two policies ride on the same manifest:
 *
 *   - `allowedInternalPackages` is the tight, per-workspace rule CLAUDE.md rule
 *     1 states: the collector depends on `@seorak/types` and npm, never on
 *     worker, push, or web.
 *   - the visibility table is the open-core rule ADR 005 decision 1 states:
 *     every boundary-crossing arrow points private to public, never the
 *     reverse.
 *
 * `moduleLoaders` is per-workspace data because the fail-closed rule against a
 * shadowed `require` exists to keep the public core's module graph statically
 * readable. `createRequire` is an ordinary pattern in a private deploy script
 * and a false finding there would only teach people to stop reading this gate.
 *
 * Findings reconcile against `docs/reference/open-core-boundary-acceptance.json`.
 * Enforcement is the DEFAULT: an accepted violation exits zero, and anything
 * undeclared fails.
 */

import { isBuiltin } from "node:module";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import {
  REPO_ROOT,
  boundaryPolicies,
  exitCodeFor,
  formatAcceptanceSection,
  loadOwnership,
  mayImport,
  readAcceptance,
  reconcile,
} from "./open-core-ownership.mjs";

const CHECK_ID = "package-boundaries";
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const NODE_MODULE_SPECIFIERS = new Set(["module", "node:module"]);

function extensionOf(path) {
  const match = /(\.[^.]+)$/.exec(path);
  return match?.[1] ?? "";
}

function filesUnder(root) {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink()) {
    return [{ path: root, symbolicLink: true }];
  }
  if (!statSync(root).isDirectory()) {
    return SOURCE_EXTENSIONS.has(extensionOf(root))
      ? [{ path: root, symbolicLink: false }]
      : [];
  }
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    if (entry.isSymbolicLink()) {
      return [{ path, symbolicLink: true }];
    }
    return SOURCE_EXTENSIONS.has(extensionOf(path))
      ? [{ path, symbolicLink: false }]
      : [];
  });
}

function packageNameOf(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function staticModuleSpecifier(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function accessedPropertyName(expression) {
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : staticModuleSpecifier(expression.argumentExpression);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function moduleLoaderBindings(file) {
  const createRequireFactories = new Set();
  const nodeModuleNamespaces = new Set();
  const requireFunctions = new Set();
  const variableDeclarations = [];
  let shadowsRequire = false;

  function bindingNames(name) {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap((element) =>
      ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
    );
  }

  function collect(node) {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      NODE_MODULE_SPECIFIERS.has(node.moduleSpecifier.text)
    ) {
      if (node.importClause.name) {
        nodeModuleNamespaces.add(node.importClause.name.text);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (importedName === "createRequire") {
            createRequireFactories.add(element.name.text);
          } else if (importedName === "default") {
            nodeModuleNamespaces.add(element.name.text);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        nodeModuleNamespaces.add(bindings.name.text);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      NODE_MODULE_SPECIFIERS.has(
        staticModuleSpecifier(node.moduleReference.expression),
      )
    ) {
      nodeModuleNamespaces.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      variableDeclarations.push(node);
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node.name &&
      bindingNames(node.name).includes("require")
    ) {
      shadowsRequire = true;
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  // A file that binds its own `require` is not using the global one, so the
  // bare name stops being a loader here either way. What differs by policy is
  // whether declaring the binding is itself reportable.
  if (!shadowsRequire) requireFunctions.add("require");

  const isNodeModuleNamespace = (expression) => {
    const unwrapped = unwrapExpression(expression);
    return (
      (ts.isIdentifier(unwrapped) &&
        nodeModuleNamespaces.has(unwrapped.text)) ||
      (ts.isCallExpression(unwrapped) &&
        ((ts.isIdentifier(unwrapped.expression) &&
          requireFunctions.has(unwrapped.expression.text)) ||
          unwrapped.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        unwrapped.arguments.length >= 1 &&
        NODE_MODULE_SPECIFIERS.has(
          staticModuleSpecifier(unwrapped.arguments[0]),
        ))
    );
  };

  const isCreateRequireFactory = (expression) =>
    (ts.isIdentifier(expression) &&
      createRequireFactories.has(expression.text)) ||
    ((ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
      isNodeModuleNamespace(expression.expression) &&
      accessedPropertyName(expression) === "createRequire");

  for (let pass = 0; pass <= variableDeclarations.length; pass += 1) {
    let changed = false;
    for (const declaration of variableDeclarations) {
      const initializer = unwrapExpression(declaration.initializer);
      if (ts.isObjectBindingPattern(declaration.name)) {
        if (!isNodeModuleNamespace(initializer)) continue;
        for (const element of declaration.name.elements) {
          if (
            !element.dotDotDotToken &&
            ts.isIdentifier(element.name) &&
            (element.propertyName ?? element.name).text === "createRequire" &&
            !createRequireFactories.has(element.name.text)
          ) {
            createRequireFactories.add(element.name.text);
            changed = true;
          }
        }
        continue;
      }
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (
        isNodeModuleNamespace(initializer) &&
        !nodeModuleNamespaces.has(name)
      ) {
        nodeModuleNamespaces.add(name);
        changed = true;
      }
      if (
        isCreateRequireFactory(initializer) &&
        !createRequireFactories.has(name)
      ) {
        createRequireFactories.add(name);
        changed = true;
      }
      if (
        ((ts.isCallExpression(initializer) &&
          isCreateRequireFactory(initializer.expression)) ||
          (ts.isIdentifier(initializer) &&
            requireFunctions.has(initializer.text))) &&
        !requireFunctions.has(name)
      ) {
        requireFunctions.add(name);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return {
    createRequireFactories,
    nodeModuleNamespaces,
    requireFunctions,
    problems: shadowsRequire
      ? ["declares the reserved module-loader binding require"]
      : [],
  };
}

export function analyzeImports(source, path = "source.ts", options = {}) {
  const { moduleLoaders = "forbidden" } = options;
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const specifiers = [];
  const problems = file.parseDiagnostics.map((diagnostic) => {
    const location =
      diagnostic.start === undefined
        ? ""
        : ` at ${file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}:${
            file.getLineAndCharacterOfPosition(diagnostic.start).character + 1
          }`;
    return `contains invalid syntax${location}`;
  });
  const {
    createRequireFactories,
    nodeModuleNamespaces,
    requireFunctions,
    problems: bindingProblems,
  } =
    moduleLoaderBindings(file);
  if (moduleLoaders === "forbidden") problems.push(...bindingProblems);

  const isNodeModuleNamespace = (expression) => {
    const unwrapped = unwrapExpression(expression);
    return (
      (ts.isIdentifier(unwrapped) &&
        nodeModuleNamespaces.has(unwrapped.text)) ||
      (ts.isCallExpression(unwrapped) &&
        ((ts.isIdentifier(unwrapped.expression) &&
          requireFunctions.has(unwrapped.expression.text)) ||
          unwrapped.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        unwrapped.arguments.length >= 1 &&
        NODE_MODULE_SPECIFIERS.has(
          staticModuleSpecifier(unwrapped.arguments[0]),
        ))
    );
  };

  function isCreateRequireFactory(expression) {
    const unwrapped = unwrapExpression(expression);
    return (
      (ts.isIdentifier(unwrapped) &&
        createRequireFactories.has(unwrapped.text)) ||
      ((ts.isPropertyAccessExpression(unwrapped) ||
        ts.isElementAccessExpression(unwrapped)) &&
        isNodeModuleNamespace(unwrapped.expression) &&
        accessedPropertyName(unwrapped) === "createRequire")
    );
  }

  const isModuleLoader = (expression) => {
    const unwrapped = unwrapExpression(expression);
    return (
      (ts.isIdentifier(unwrapped) &&
        requireFunctions.has(unwrapped.text) &&
        !createRequireFactories.has(unwrapped.text)) ||
      (ts.isCallExpression(unwrapped) &&
        isCreateRequireFactory(unwrapped.expression))
    );
  };

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = staticModuleSpecifier(
        node.moduleReference.expression,
      );
      if (specifier === undefined) {
        problems.push(
          "contains a non-literal TypeScript import-equals module load",
        );
      } else {
        specifiers.push(specifier);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      const specifier =
        ts.isLiteralTypeNode(argument) &&
        staticModuleSpecifier(argument.literal);
      if (specifier === undefined) {
        problems.push("contains a non-literal TypeScript import type");
      } else {
        specifiers.push(specifier);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = staticModuleSpecifier(node.arguments[0]);
      if (specifier === undefined) {
        problems.push("contains a non-literal dynamic import");
      } else {
        specifiers.push(specifier);
      }
    } else if (
      ts.isElementAccessExpression(node) &&
      isNodeModuleNamespace(node.expression) &&
      staticModuleSpecifier(node.argumentExpression) === undefined
    ) {
      problems.push("contains computed node:module member access");
    } else if (
      ts.isCallExpression(node) &&
      isModuleLoader(node.expression)
    ) {
      const specifier =
        node.arguments.length === 1
          ? staticModuleSpecifier(node.arguments[0])
          : undefined;
      if (specifier === undefined) {
        const loaderName = ts.isIdentifier(node.expression)
          ? node.expression.text
          : "createRequire";
        problems.push(
          `contains a non-literal ${loaderName} module load`,
        );
      } else {
        specifiers.push(specifier);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { specifiers, problems };
}

export function importSpecifiers(source, path = "source.ts") {
  return analyzeImports(source, path).specifiers;
}

function isWithin(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function pathSegments(root, target) {
  const path = relative(root, target);
  return path === "" ? [] : path.split(sep);
}

function traversesSymbolicLink(root, target) {
  let current = root;
  for (const segment of pathSegments(root, target)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

function dependencyEntries(manifest, section) {
  const value = manifest[section];
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${section} must be an object`);
  }
  return Object.entries(value).map(([name, specifier]) => {
    if (typeof specifier !== "string") {
      throw new Error(`${section}.${name} must be a string`);
    }
    return [name, specifier];
  });
}

function manifestDependencyModel(packageRoot) {
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${packageRoot}/package.json has no package name`);
  }
  const sections = Object.fromEntries(
    DEPENDENCY_SECTIONS.map((section) => [
      section,
      dependencyEntries(manifest, section),
    ]),
  );
  const production = new Set([
    ...sections.dependencies.map(([name]) => name),
    ...sections.optionalDependencies.map(([name]) => name),
    ...sections.peerDependencies.map(([name]) => name),
  ]);
  return {
    name: manifest.name,
    exports: manifest.exports,
    sections,
    production,
    development: new Set([
      ...production,
      ...sections.devDependencies.map(([name]) => name),
    ]),
  };
}

function packageNameFromVersionAlias(specifier) {
  const match = /^(?:npm:|workspace:)(@[^/]+\/[^@]+)(?:@.*)?$/.exec(
    specifier,
  );
  return match?.[1];
}

function packageNameFromPathAlias(packageRoot, specifier) {
  const path = /^(?:file:|link:|workspace:)?(\.{1,2}\/.*|\/.*)$/.exec(
    specifier,
  )?.[1];
  if (!path) return { matched: false };
  const manifestPath = resolve(packageRoot, path, "package.json");
  if (!existsSync(manifestPath)) {
    return {
      matched: true,
      problem: `cannot verify local dependency target ${specifier}`,
    };
  }
  try {
    const target = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof target.name !== "string" || target.name.length === 0) {
      return {
        matched: true,
        problem: `local dependency target ${specifier} has no package name`,
      };
    }
    return { matched: true, packageName: target.name };
  } catch {
    return {
      matched: true,
      problem: `cannot read local dependency target ${specifier}`,
    };
  }
}

function dependencyTargetPackageName(packageRoot, name, specifier) {
  const pathAlias = packageNameFromPathAlias(packageRoot, specifier);
  if (pathAlias.matched) return pathAlias;
  return {
    matched: true,
    packageName: packageNameFromVersionAlias(specifier) ?? name,
  };
}

function matchesExportKey(subpath, key) {
  if (!key.includes("*")) return subpath === key;
  const [prefix, suffix] = key.split("*");
  return subpath.startsWith(prefix) && subpath.endsWith(suffix);
}

function hasEnabledExportTarget(target) {
  if (typeof target === "string") return true;
  if (Array.isArray(target)) return target.some(hasEnabledExportTarget);
  if (target && typeof target === "object") {
    return Object.values(target).some(hasEnabledExportTarget);
  }
  return false;
}

function isExportedSelfReference(manifest, specifier) {
  const remainder = specifier.slice(manifest.name.length);
  const subpath = remainder === "" ? "." : `.${remainder}`;
  const exportsField = manifest.exports;
  if (exportsField === undefined || exportsField === null) return false;
  if (typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return subpath === "." && hasEnabledExportTarget(exportsField);
  }
  const keys = Object.keys(exportsField);
  if (!keys.some((key) => key.startsWith("."))) {
    return subpath === "." && hasEnabledExportTarget(exportsField);
  }
  if (Object.hasOwn(exportsField, subpath)) {
    return hasEnabledExportTarget(exportsField[subpath]);
  }
  const matchingPatterns = keys
    .filter((key) => key.includes("*") && matchesExportKey(subpath, key))
    .sort((left, right) => right.length - left.length);
  return (
    matchingPatterns.length > 0 &&
    hasEnabledExportTarget(exportsField[matchingPatterns[0]])
  );
}

/**
 * A workspace package the manifest knows by name, or `undefined` for an
 * ordinary npm dependency. This is what replaced the `@seorak/` prefix test.
 */
function internalWorkspaceVisibility(policy, packageName) {
  return policy.workspacePackages?.get(packageName);
}

export function boundaryProblemsForPolicy(
  repositoryRoot,
  policy,
) {
  const packageRoot = resolve(repositoryRoot, policy.packageRoot);
  const manifest = manifestDependencyModel(packageRoot);
  const problems = [];
  const visibilities = policy.visibilities ?? {};
  const crossesBoundary = (targetVisibility) =>
    policy.visibility !== undefined &&
    targetVisibility !== undefined &&
    !mayImport({ visibilities }, policy.visibility, targetVisibility);

  if (manifest.name !== policy.packageName) {
    problems.push(
      `${policy.packageRoot}/package.json name ${manifest.name} does not match boundary identity ${policy.packageName}`,
    );
  }

  for (const section of DEPENDENCY_SECTIONS) {
    for (const [dependency, specifier] of manifest.sections[section]) {
      const target = dependencyTargetPackageName(
        packageRoot,
        dependency,
        specifier,
      );
      if (target.problem) {
        problems.push(
          `${policy.packageRoot}/package.json ${section} ${target.problem}`,
        );
        continue;
      }
      const targetPackage = target.packageName;
      const targetVisibility = internalWorkspaceVisibility(policy, targetPackage);
      if (targetVisibility === undefined) continue;
      if (!policy.allowedInternalPackages.has(targetPackage)) {
        problems.push(
          `${policy.packageRoot}/package.json ${section} declares forbidden internal dependency ${targetPackage} as ${dependency}`,
        );
      } else if (crossesBoundary(targetVisibility)) {
        problems.push(
          `${policy.packageRoot}/package.json ${section} declares ${targetVisibility} dependency ${targetPackage}, which a ${policy.visibility} workspace may not carry`,
        );
      }
    }
  }

  for (const sourceRoot of policy.sourceRoots) {
    if (
      !sourceRoot ||
      typeof sourceRoot.path !== "string" ||
      !["production", "development"].includes(sourceRoot.mode)
    ) {
      throw new Error(
        `${policy.packageRoot} has an invalid source-root boundary policy`,
      );
    }
    for (const entry of filesUnder(resolve(packageRoot, sourceRoot.path))) {
      const { path } = entry;
      const repositoryPath = relative(repositoryRoot, path).split(sep).join("/");
      if (entry.symbolicLink) {
        problems.push(
          `${repositoryPath} is a symbolic link inside a covered source root`,
        );
        continue;
      }
      // A co-located test is development code wherever it sits. `packages/web`
      // keeps its suites beside the modules they cover, so a directory-only
      // model would report every one of them as a production dependency
      // violation and the gate would be deleted within a week.
      const mode =
        sourceRoot.mode === "production" &&
        (policy.developmentMatchers ?? []).some((matcher) =>
          matcher.test(repositoryPath),
        )
          ? "development"
          : sourceRoot.mode;
      const dependencies =
        mode === "production" ? manifest.production : manifest.development;
      const source = readFileSync(path, "utf8");
      const analysis = analyzeImports(source, path, {
        moduleLoaders: policy.moduleLoaders ?? "forbidden",
      });
      for (const problem of analysis.problems) {
        problems.push(`${repositoryPath} ${problem}`);
      }
      for (const specifier of analysis.specifiers) {
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          const target = resolve(dirname(path), specifier);
          if (!isWithin(packageRoot, target)) {
            problems.push(
              `${repositoryPath} imports outside ${policy.packageRoot}: ${specifier}`,
            );
          } else if (
            pathSegments(packageRoot, target).includes("node_modules")
          ) {
            problems.push(
              `${repositoryPath} imports through package-local node_modules: ${specifier}`,
            );
          } else if (traversesSymbolicLink(packageRoot, target)) {
            problems.push(
              `${repositoryPath} imports through a symbolic link: ${specifier}`,
            );
          }
          continue;
        }
        if (isBuiltin(specifier)) continue;

        const packageName = packageNameOf(specifier);
        if (packageName === policy.packageName) {
          if (!isExportedSelfReference(manifest, specifier)) {
            problems.push(
              `${repositoryPath} imports unexported self-reference ${specifier}`,
            );
          }
          continue;
        }
        const targetVisibility = internalWorkspaceVisibility(policy, packageName);
        if (targetVisibility !== undefined) {
          if (!policy.allowedInternalPackages.has(packageName)) {
            problems.push(
              `${repositoryPath} crosses a forbidden package boundary: ${specifier}`,
            );
            continue;
          }
          if (crossesBoundary(targetVisibility)) {
            problems.push(
              `${repositoryPath} imports ${targetVisibility} package ${packageName}, which a ${policy.visibility} workspace may not read`,
            );
            continue;
          }
        }
        if (!dependencies.has(packageName)) {
          problems.push(
            `${repositoryPath} imports undeclared ${mode} dependency ${packageName}`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * One finding per distinct problem. The same problem can occur twice in one
 * file (two non-literal dynamic imports, say); the acceptance file records a
 * violation, not an occurrence, so the count travels in the detail line.
 */
function findingsFor(repositoryRoot, policies) {
  const byKey = new Map();
  for (const policy of policies) {
    for (const problem of boundaryProblemsForPolicy(repositoryRoot, policy)) {
      const existing = byKey.get(problem);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      byKey.set(problem, {
        key: problem,
        occurrences: 1,
        policy: `${policy.packageRoot} (${policy.visibility ?? "unclassified"}) workspace policy`,
      });
    }
  }
  return [...byKey.values()].map((finding) => ({
    key: finding.key,
    detail:
      finding.occurrences === 1
        ? finding.policy
        : `${finding.policy}, ${finding.occurrences} occurrences`,
  }));
}

export function checkPackageBoundaries(repositoryRoot = REPO_ROOT, policies) {
  if (policies !== undefined) {
    return {
      problems: [],
      findings: findingsFor(repositoryRoot, policies),
      workspaceCount: policies.length,
    };
  }
  const { manifest, problems } = loadOwnership(repositoryRoot);
  if (manifest === undefined) {
    return { problems, findings: [], workspaceCount: 0 };
  }
  // A workspace with no manifest in this tree is not a policy this tree can
  // enforce. In the repository that owns both halves that never happens, and
  // the ownership map's own coverage rule catches a deleted workspace by
  // failing on the path rule that then matches nothing. In the public
  // repository the private workspaces are absent by construction, and reading
  // their package.json threw before this gate reported anything at all.
  const resolved = boundaryPolicies(manifest).filter((policy) =>
    existsSync(resolve(repositoryRoot, policy.packageRoot, "package.json")),
  );
  const absent = boundaryPolicies(manifest).length - resolved.length;
  return {
    problems,
    findings: findingsFor(repositoryRoot, resolved),
    workspaceCount: manifest.workspaces.length,
    policyCount: resolved.length,
    absentWorkspaceCount: absent,
  };
}

export function formatReport(result, reconciliation, strict, staleFails = true) {
  const lines = [
    `Package boundary check (${strict ? "strict" : "acceptance-reconciled"}). Ownership map: docs/reference/open-core-ownership.json.`,
    `Covered ${result.policyCount ?? result.workspaceCount} of ${result.workspaceCount} workspaces with an npm manifest.`,
  ];
  if (result.absentWorkspaceCount) {
    lines.push(
      `${result.absentWorkspaceCount} workspace(s) the map places are not in this tree, so their policies were not enforced here.`,
    );
  }
  for (const problem of result.problems) lines.push(`! ${problem}`);
  lines.push("");
  lines.push(...formatAcceptanceSection(reconciliation, strict, staleFails));
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
  const result = checkPackageBoundaries(repositoryRoot);
  const acceptance = readAcceptance(repositoryRoot);
  const reconciliation = reconcile(result.findings, acceptance.entries, CHECK_ID);
  const problems = [...result.problems, ...acceptance.problems];
  // Six of the eight acceptance entries name private workspaces. In a tree that
  // holds one half of the split they cannot be reproduced, and unreproducible
  // is not falsified.
  const staleFails = result.absentWorkspaceCount === undefined || result.absentWorkspaceCount === 0;
  console.log(formatReport({ ...result, problems }, reconciliation, strict, staleFails));
  process.exitCode = exitCodeFor({ problems, reconciliation, strict, staleFails });
}
