/**
 * git/numstat.ts — reading `git log/diff --numstat` output, and the generated-file
 * ignore set applied to it.
 *
 * These four pieces are SHARED by every counting walk in the collector (momentum,
 * the session delta, and the commit-history walker), which is why they live below
 * all three rather than inside whichever one happens to be read first.
 *
 * PRIVACY: paths are read here for ignore-matching and rename resolution only. No
 * function in this module emits anything; callers receive COUNTS, and the path
 * strings stay on the machine.
 */
import { basename } from "node:path";

/** Default generated/lockfile ignore globs. Their changed lines are counted as
 *  `generatedLinesExcluded` (auditable), never folded into the headline LOC. */
export const DEFAULT_IGNORE_GLOBS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "dist/",
  "build/",
  "*.generated.*",
  "*.snap",
  "*.xcassets",
];

/**
 * Compile a tiny glob set into a matcher. Supported forms (sufficient for the
 * default + env overrides; not a full glob engine):
 *   - "dir/"            -> path contains that directory segment prefix
 *   - "*.ext" / "*x*y*" -> '*' is any run of chars, anchored to the basename
 *   - "literal"         -> exact basename match OR exact full-path match
 * A path is ignored if ANY pattern matches.
 */
export function compileIgnore(globs: string[]): (path: string) => boolean {
  const dirPrefixes: string[] = [];
  const baseRegexes: RegExp[] = [];
  const literals: string[] = [];

  for (const raw of globs) {
    const g = raw.trim();
    if (g.length === 0) continue;
    if (g.endsWith("/")) {
      dirPrefixes.push(g);
      continue;
    }
    if (g.includes("*")) {
      const escaped = g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      baseRegexes.push(new RegExp(`^${escaped}$`));
      continue;
    }
    literals.push(g);
  }

  return (path: string): boolean => {
    const base = basename(path);
    for (const d of dirPrefixes) {
      // match "dist/..." or ".../dist/..."
      if (path === d.slice(0, -1) || path.startsWith(d) || path.includes(`/${d}`)) return true;
    }
    for (const re of baseRegexes) {
      if (re.test(base)) return true;
    }
    for (const lit of literals) {
      if (base === lit || path === lit) return true;
    }
    return false;
  };
}

/** A numstat line: "<added>\t<deleted>\t<path>". Binary files use "-" markers,
 *  which count as 0 lines. Returns null for non-numstat lines (commit hashes,
 *  blanks). The path may contain rename arrows ("old => new"); we keep the
 *  whole field for ignore-matching but never emit it. */
export function parseNumstatLine(
  line: string,
): { added: number; deleted: number; path: string } | null {
  // numstat columns are tab-separated.
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const addedRaw = parts[0]!;
  const deletedRaw = parts[1]!;
  const path = parts.slice(2).join("\t");
  if (path.length === 0) return null;
  const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
  const deleted = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10);
  if (!Number.isFinite(added) || !Number.isFinite(deleted)) return null;
  return { added, deleted, path };
}

/**
 * Resolve a `--numstat` path field to the path the lines LIVE AT after the commit.
 * With rename detection on (`-M`), git factors the common parts of a rename:
 *
 *   "src/{old => new}.ts"          -> "src/new.ts"
 *   "packages/{web => worker}/x.ts"-> "packages/worker/x.ts"
 *   "src/{foo/ => }bar.ts"         -> "src/bar.ts"     (moved up a directory)
 *   "old.ts => new.ts"             -> "new.ts"         (no common parts)
 *   "src/plain.ts"                 -> "src/plain.ts"   (not a rename)
 *
 * We want the TARGET because blame reads the tip, where only the new path exists.
 * Exported for its unit test. LOCAL ONLY — never emitted.
 */
export function resolveNumstatPath(raw: string): string {
  const brace = /^(.*)\{(.*?) => (.*?)\}(.*)$/.exec(raw);
  if (brace) {
    // Collapse the "" case ("{foo/ => }bar") which would otherwise leave a double slash.
    return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/{2,}/g, "/");
  }
  const arrow = raw.split(" => ");
  return arrow.length === 2 ? arrow[1]! : raw;
}

/** Marks a commit-header line in the walkers' `git log` output. It cannot be a leading
 *  SPACE, which is the obvious choice: `git()` trims the whole stdout, so the first
 *  commit's header would lose its marker and be misread as a numstat line — silently
 *  dropping the NEWEST commit from every walk. "@@@" survives the trim, and a numstat
 *  line can never begin with it (those begin with a digit or "-"). */
export const SENTINEL = "@@@";
