/**
 * file-language.ts — derive the language FAMILY of a file from its extension
 * (CAPTURE-FOUNDATION ADR-CF5). The finer increment over the 7-bucket
 * `fileCategory`: it reveals stack MIX (a Rust repo vs a Python one) while staying
 * a CLOSED family enum (dialects/versions collapse) so it is not a per-file
 * fingerprint. Runs on-machine against the path already in hand (file-id.ts),
 * which is then discarded — only the enum ships. Returns undefined for an unmapped
 * extension (honest-empty, never a guessed value — the `fileCategory` discipline).
 */
import { basename } from "node:path";
import type { FileLanguage } from "@seorak/types";

/** Extension → language FAMILY. Kept coarse: tsx/ts→typescript, c/h→c, etc. */
const EXTENSION_LANGUAGE: Record<string, FileLanguage> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  lua: "lua",
  html: "html", htm: "html",
  css: "css", scss: "css", sass: "css", less: "css", styl: "css",
  sql: "sql",
  md: "markdown", mdx: "markdown",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  vue: "vue",
  svelte: "svelte",
};

/**
 * deriveFileLanguage(path) — the language family of `path`, or undefined when the
 * extension maps to no known family (never a guess). The path is read locally
 * (basename + extension) and discarded; only the enum is returned.
 */
export function deriveFileLanguage(path: string): FileLanguage | undefined {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined; // no extension / dotfile → no language rule
  const ext = base.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext];
}
