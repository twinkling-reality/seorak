#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const DEFAULT_SOURCE_ROOTS = [
  "packages/web/src",
  "packages/types/src",
  "packages/collector/src",
  "packages/control-plane/src",
  "packages/worker/src",
  "apps/mobile/src",
  "apps/mobile/targets",
];

const INTERNAL_VALUE_KEYS = new Set(["id", "slug", "key"]);

/**
 * Surfaces that hold the em-dash rule: customer-facing pricing and plan copy,
 * plus the field journal.
 *
 * The scope is explicit rather than repository-wide, because an em dash is
 * ordinary punctuation in internal comments, tests, and documentation, and
 * banning it there would be a house style edict rather than a copy contract.
 *
 * The journal was added on 2026-08-02. An earlier version of this comment
 * argued that an em dash is ordinary punctuation "in blog prose" and left the
 * journal out. That conflicted with the journal's own adopted house style,
 * which has prohibited the em dash since the blog shipped, so the rule the
 * writing already follows is now the rule the build enforces. See
 * `docs/reference/editorial-system.md`.
 */
const EM_DASH_COPY_PATHS = [
  "packages/web/src/marketing/pages/pricing/",
  "packages/control-plane/src/billingHtml.ts",
  "packages/web/src/marketing/blog/posts/",
  "packages/web/src/marketing/content/",
];

function isEmDashScopedCopy(relativePath) {
  return EM_DASH_COPY_PATHS.some(
    (path) => relativePath === path || relativePath.startsWith(path),
  );
}

const FORBIDDEN = [
  { kind: "middot", pattern: /·/, message: "replace the middot with plain punctuation or separate copy" },
  { kind: "signal", pattern: /\bsignals?\b/i, message: 'use "stat", "watch", "reading", or another contextual product term' },
  {
    kind: "em-dash",
    /*
     * The character itself, the spaced stand-in (` -- `), and the joined
     * stand-in (`plan--price`). A CSS custom property (`var(--ink)`) and a CLI
     * long flag (`--purge`) are neither, because both attach their hyphens
     * directly to the identifier that follows.
     */
    pattern: /—|\s--\s|[A-Za-z0-9)]--[A-Za-z0-9(]/,
    message:
      'this copy joins clauses with a comma, "and", or a new sentence, never an em dash',
    appliesTo: isEmDashScopedCopy,
  },
];

function forbiddenFor(relativePath) {
  return FORBIDDEN.filter(
    (forbidden) => !forbidden.appliesTo || forbidden.appliesTo(relativePath),
  );
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function isProductionTypeScript(path) {
  const normalized = normalizePath(path);
  return (
    /\.(?:ts|tsx)$/.test(normalized) &&
    !/\.d\.ts$/.test(normalized) &&
    !/(?:^|\/)__tests__(?:\/|$)/.test(normalized) &&
    !/\.(?:test|spec)\.[^.]+$/.test(normalized)
  );
}

function moduleSpecifierAncestor(node) {
  let current = node;
  while (current) {
    if (
      (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) &&
      current.moduleSpecifier
    ) {
      return current.moduleSpecifier === node || current.moduleSpecifier.getStart() <= node.getStart()
        ? current
        : null;
    }
    if (ts.isImportTypeNode(current) || ts.isExternalModuleReference(current)) return current;
    current = current.parent;
  }
  return null;
}

function hasTypeAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function isInternalLiteral(node) {
  if (moduleSpecifierAncestor(node) || hasTypeAncestor(node)) return true;
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isPropertyAssignment(parent) && INTERNAL_VALUE_KEYS.has(propertyNameText(parent.name))) return true;
  return false;
}

function ancestor(node, predicate) {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * A browser tab title may carry the middot; product prose may not.
 *
 * Two sites hold that exemption, and both are single definitions rather than a
 * list of files allowed to compose the string themselves. That distinction is
 * the point: an allowlist of composing files silently stops protecting anything
 * as it grows, and it grew once already, to five modules writing `X · Seorak` by
 * hand with a comment in one of them asking the others not to drift.
 *
 * `documentTitle` in `marketing/paths.ts` is the composer every page calls, and
 * `META` in `routeModel.ts` is the static route table whose titles are whole
 * literals rather than compositions, including one that reads `Seorak · ...` in
 * the other order. Anywhere else, hand-composing a title fails this gate.
 */
function isDocumentTitleMiddot(node, relativePath) {
  if (relativePath === "packages/web/src/marketing/paths.ts") {
    const composer = ancestor(
      node,
      (candidate) =>
        ts.isFunctionDeclaration(candidate) && candidate.name?.text === "documentTitle",
    );
    if (composer) return true;
  }

  return Boolean(
    relativePath === "packages/web/src/marketing/routes/routeModel.ts" &&
      ancestor(
        node,
        (candidate) =>
          ts.isPropertyAssignment(candidate) && propertyNameText(candidate.name) === "title",
      ),
  );
}

function isShaderLiteral(node, relativePath) {
  const allowed =
    relativePath === "packages/web/src/marketing/scene/HeroFigure.tsx"
      ? "VERT"
      : relativePath === "packages/web/src/marketing/scene/shaders/pointCloud.vert.ts"
        ? "POINT_CLOUD_VERT"
        : null;
  if (!allowed) return false;
  const declaration = ancestor(node, ts.isVariableDeclaration);
  return Boolean(
    declaration && ts.isIdentifier(declaration.name) && declaration.name.text === allowed,
  );
}

function literalText(node) {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isJsxText(node) ||
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail
  ) {
    return node.text;
  }
  return null;
}

function issueFor(sourceFile, path, kind, message, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path,
    line: position.line + 1,
    column: position.character + 1,
    kind,
    message,
  };
}

function scanTypeScript(path, relativePath) {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const issues = [];
  const rules = forbiddenFor(relativePath);

  function visit(node) {
    const text = literalText(node);
    if (text !== null && !isInternalLiteral(node)) {
      for (const forbidden of rules) {
        if (!forbidden.pattern.test(text)) continue;
        if (
          forbidden.kind === "middot" &&
          (isDocumentTitleMiddot(node, relativePath) || isShaderLiteral(node, relativePath))
        ) {
          continue;
        }
        if (forbidden.kind === "signal" && isShaderLiteral(node, relativePath)) continue;
        issues.push(
          issueFor(sourceFile, relativePath, forbidden.kind, forbidden.message, node),
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

function scanCss(path, relativePath) {
  const source = stripCssComments(readFileSync(path, "utf8"));
  const issues = [];
  const declaration = /\bcontent\s*:\s*(['"])([\s\S]*?)\1/g;
  const rules = forbiddenFor(relativePath);
  for (const match of source.matchAll(declaration)) {
    const value = match[2];
    for (const forbidden of rules) {
      if (!forbidden.pattern.test(value)) continue;
      const before = source.slice(0, match.index);
      const lines = before.split("\n");
      issues.push({
        path: relativePath,
        line: lines.length,
        column: lines.at(-1).length + 1,
        kind: forbidden.kind,
        message: forbidden.message,
      });
    }
  }
  return issues;
}

function swiftStringLiterals(source) {
  const literals = [];
  let blockCommentDepth = 0;
  let index = 0;

  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (blockCommentDepth > 0) {
      if (pair === "/*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (pair === "*/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (pair === "//") {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (pair === "/*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    let hashCount = 0;
    while (source[index + hashCount] === "#") hashCount += 1;
    const quoteIndex = index + hashCount;
    if (source[quoteIndex] !== '"') {
      index += 1;
      continue;
    }

    const quoteCount = source.slice(quoteIndex, quoteIndex + 3) === '"""' ? 3 : 1;
    const contentStart = quoteIndex + quoteCount;
    const closing = '"'.repeat(quoteCount) + "#".repeat(hashCount);
    let cursor = contentStart;
    while (cursor < source.length) {
      if (source.startsWith(closing, cursor)) break;
      if (
        hashCount === 0 &&
        source[cursor] === "\\" &&
        quoteCount === 1
      ) {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }

    literals.push({
      start: contentStart,
      text: source.slice(contentStart, cursor),
    });
    index = cursor < source.length ? cursor + closing.length : source.length;
  }

  return literals;
}

function scanSwift(path, relativePath) {
  const source = readFileSync(path, "utf8");
  const issues = [];
  const rules = forbiddenFor(relativePath);
  for (const literal of swiftStringLiterals(source)) {
    for (const forbidden of rules) {
      const match = forbidden.pattern.exec(literal.text);
      if (!match) continue;
      const before = source.slice(0, literal.start + match.index);
      const lines = before.split("\n");
      issues.push({
        path: relativePath,
        line: lines.length,
        column: lines.at(-1).length + 1,
        kind: forbidden.kind,
        message: forbidden.message,
      });
    }
  }
  return issues;
}

export function scanProductCopy({
  repoRoot,
  sourceRoots = DEFAULT_SOURCE_ROOTS,
} = {}) {
  const root = resolve(repoRoot ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const issues = [];

  for (const sourceRoot of sourceRoots) {
    for (const path of walk(resolve(root, sourceRoot))) {
      const relativePath = normalizePath(relative(root, path));
      if (isProductionTypeScript(path)) {
        issues.push(...scanTypeScript(path, relativePath));
      } else if (/\.css$/.test(path)) {
        issues.push(...scanCss(path, relativePath));
      } else if (/\.swift$/.test(path)) {
        issues.push(...scanSwift(path, relativePath));
      }
    }
  }
  return issues.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.column - b.column ||
      a.kind.localeCompare(b.kind),
  );
}

function formatIssue(issue) {
  return `${issue.path}:${issue.line}:${issue.column} [${issue.kind}] ${issue.message}`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const issues = scanProductCopy();
  if (issues.length > 0) {
    console.error(`Product copy check failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):`);
    issues.forEach((issue) => console.error(`- ${formatIssue(issue)}`));
    process.exitCode = 1;
  } else {
    console.log("Product copy check passed.");
  }
}
