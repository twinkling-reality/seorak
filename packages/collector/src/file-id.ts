/**
 * file-id.ts — salted per-file identity for edit-family tool calls
 * (CAPTURE-PRINCIPLE: the repoId move one level down). The absolute path is
 * read locally, hashed with the SAME per-machine salt + "\0" recipe as repoId
 * (git.ts), and discarded — only the 64-hex ids ship. Labels (basenames ONLY,
 * never a longer path segment) ride along solely when the developer opted into
 * the default-OFF `fileLabels` capture toggle.
 */
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import type { FileCategory, FileLanguage } from "@seorak/types";
import { deriveFileLanguage } from "./file-language.ts";
import { readOrCreateSalt } from "./git.ts";

export interface FileIdentity {
  fileId: string;
  dirId: string;
  /** Coarse file kind (closed enum). Derived from the path HERE, where the
   *  path is already in hand and about to be discarded. Not gated by the
   *  fileLabels opt-in: seven buckets cannot reconstruct a name. */
  fileCategory?: FileCategory;
  /** Language FAMILY (closed enum), derived from the same path. Rides the
   *  fileSignals gate with fileId; absent when the extension maps to no rule. */
  fileLanguage?: FileLanguage;
  fileLabel?: string;
  dirLabel?: string;
}

/** The edit-family tools whose payloads name a file. Mirrors deriveEditLines'
 *  tool set (adapters/claude-code.ts) — file heat counts the same calls the
 *  line capture measures. */
const EDIT_FAMILY_PATH_KEYS: Record<string, string> = {
  Edit: "file_path",
  MultiEdit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
};

function saltedId(salt: string, seed: string): string {
  return createHash("sha256").update(salt).update("\0").update(seed).digest("hex");
}

/** Extension → category. Coarse on purpose: the buckets must stay a CLOSED
 *  enum (capture boundary) and be meaningful to a stranger, so no per-language
 *  taxonomy — TypeScript and Rust are both "source". */
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  // source
  ts: "source", tsx: "source", js: "source", jsx: "source", mjs: "source", cjs: "source",
  py: "source", rb: "source", go: "source", rs: "source", java: "source", kt: "source",
  swift: "source", c: "source", h: "source", cpp: "source", hpp: "source", cc: "source",
  cs: "source", php: "source", sh: "source", zsh: "source", bash: "source", lua: "source",
  vue: "source", svelte: "source", astro: "source", html: "source", ipynb: "source",
  // styles
  css: "styles", scss: "styles", sass: "styles", less: "styles", styl: "styles",
  // docs
  md: "docs", mdx: "docs", rst: "docs", adoc: "docs", txt: "docs",
  // config
  json: "config", yaml: "config", yml: "config", toml: "config", ini: "config",
  plist: "config", env: "config", properties: "config", conf: "config", lock: "config",
  // data
  csv: "data", tsv: "data", sql: "data", jsonl: "data", ndjson: "data", parquet: "data",
  sqlite: "data", db: "data",
};

/** Path segments that mark a file as test regardless of its extension. */
const TEST_SEGMENT = /(^|\/)(__tests__|__mocks__|tests?|specs?)(\/|$)/;
/** Basename suffixes that mark a test file (foo.test.ts, foo.spec.tsx, foo_test.go). */
const TEST_BASENAME = /(\.(test|spec)\.[^.]+|_test\.[^.]+)$/;

/**
 * Derive the coarse file kind from a path. Runs on the machine against the
 * local path, which is then discarded — only the enum value ships. "other"
 * means "no rule matched", never a guess; dotfiles with no extension
 * (.gitignore, .npmrc) read as config.
 */
export function deriveFileCategory(path: string): FileCategory {
  const base = basename(path);
  if (TEST_BASENAME.test(base) || TEST_SEGMENT.test(path)) return "test";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    // No extension: dotfiles (.gitignore) and rc-style names read as config;
    // bare names (Makefile, LICENSE) have no rule.
    return base.startsWith(".") ? "config" : "other";
  }
  const ext = base.slice(dot + 1).toLowerCase();
  // rc-style dotfiles with an extension (.eslintrc.json) are config already
  // via the json/yaml extensions; .eslintrc alone hits the dotfile rule above.
  return EXTENSION_CATEGORY[ext] ?? "other";
}

/**
 * Derive the salted file identity of an edit-family call. Returns undefined —
 * never a partial — for non-edit tools and payloads without a usable path, so
 * absence keeps meaning "not an attributable edit".
 */
export function deriveFileIdentity(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
  withLabels: boolean,
): FileIdentity | undefined {
  if (!toolName || !toolInput) return undefined;
  const pathKey = EDIT_FAMILY_PATH_KEYS[toolName];
  if (!pathKey) return undefined;
  const path = toolInput[pathKey];
  if (typeof path !== "string" || path.length === 0) return undefined;
  return fileIdentityForPath(path, withLabels);
}

/**
 * The path-level identity derivation both adapters share: Claude reaches it
 * through the tool-name → path-key table above; the Codex adapter calls it
 * directly with a `patch_apply_end.changes` key (an absolute path, read here
 * and discarded). Same salt, same recipe, so "file
 * heat" means one thing across tools.
 */
export function fileIdentityForPath(path: string, withLabels: boolean): FileIdentity {
  const salt = readOrCreateSalt();
  const dir = dirname(path);
  const language = deriveFileLanguage(path);
  return {
    fileId: saltedId(salt, path),
    dirId: saltedId(salt, dir),
    fileCategory: deriveFileCategory(path),
    ...(language !== undefined ? { fileLanguage: language } : {}),
    ...(withLabels ? { fileLabel: basename(path), dirLabel: basename(dir) } : {}),
  };
}
