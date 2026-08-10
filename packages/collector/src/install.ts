/**
 * install.ts — the shared hook-merge logic behind both the manual installer
 * entry point and the `seorak init` CLI.
 *
 * Idempotently MERGES the six Seorak collector hook bindings into Claude Code's
 * settings.json (default ~/.claude/settings.json, override with SEORAK_SETTINGS),
 * preserving any hooks already present. `removeHooks` is the inverse: it strips
 * only the Seorak bindings (matched by bin-script name), leaving everything else.
 *
 * The merge/strip logic is split into PURE functions (mergeHooks / stripHooks)
 * that operate on a settings object, so the CLI's status checks and the tests can
 * reason about them without touching disk; installHooks/removeHooks wrap them with
 * read → backup → write.
 *
 * The six bindings (PostToolUse and PostToolUseFailure are SEPARATE Claude Code
 * events — both must be bound or failed tool calls go uncounted and the error rate
 * silently undercounts):
 *   SessionStart        -> hook-session-start.mjs
 *   PostToolUse         -> hook-tool-use.mjs   (success: errored=false)
 *   PostToolUseFailure  -> hook-tool-use.mjs   (failure: errored=true)
 *   SessionEnd          -> hook-session-end.mjs
 *   Notification        -> hook-notification.mjs (needs-you signal, ADR-008)
 *   UserPromptSubmit    -> hook-user-prompt.mjs (steering cadence, envelope-only)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectorExecutableDirectory } from "./package-layout.ts";

/** Claude Code event → the Seorak bin script bound to it. The KEYSTONE map: the
 *  install/remove/status logic all key off these six entries. */
export const EVENT_BINS: Record<string, string> = {
  SessionStart: "hook-session-start.mjs",
  PostToolUse: "hook-tool-use.mjs",
  PostToolUseFailure: "hook-tool-use.mjs",
  SessionEnd: "hook-session-end.mjs",
  Notification: "hook-notification.mjs",
  UserPromptSubmit: "hook-user-prompt.mjs",
};

/** The six Claude Code events Seorak binds, in install order. */
export const SEORAK_EVENTS = Object.keys(EVENT_BINS);

export interface InstallOptions {
  /** Target settings.json. Default: $SEORAK_SETTINGS || ~/.claude/settings.json. */
  settingsPath?: string;
  /** Dir holding the hook .mjs scripts. Default: the collector's bin/ dir. */
  binDir?: string;
}

export interface InstallResult {
  added: string[];
  skipped: string[];
  /** Removed events (removeHooks only); always [] for installHooks. */
  removed: string[];
  /** Events whose Seorak binding pointed at a script that no longer exists (a
   *  moved/renamed checkout) and was re-pointed to the current bin dir. */
  repaired: string[];
  settingsPath: string;
  /** True when a .bak was written (an existing file was overwritten). */
  backedUp: boolean;
}

/** The default hook-script dir for the source or compiled package layout. */
export function defaultBinDir(): string {
  return collectorExecutableDirectory();
}

/** The default settings target, honoring SEORAK_SETTINGS (test override). */
export function defaultSettingsPath(): string {
  return process.env.SEORAK_SETTINGS || join(homedir(), ".claude", "settings.json");
}

function quotePosixArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

/**
 * The shell command Claude Code runs for a given hook bin file.
 *
 * POSIX shells receive two fully single-quoted paths. Windows receives only
 * fixed shell syntax plus a base64url file URL, so cmd.exe cannot expand path
 * metacharacters. The marker is an inert argv value that lets status and
 * uninstall recover the exact path without reparsing a shell command.
 */
export function commandFor(
  binFile: string,
  binDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const scriptPath = join(binDir, binFile);
  const encodedPath = Buffer.from(pathToFileURL(scriptPath).href, "utf8").toString(
    "base64url",
  );
  const marker = `--seorak-hook-path=${encodedPath}`;
  if (platform === "win32") {
    return `node -e "import(Buffer.from(process.argv[1],'base64url').toString())" ${encodedPath} ${marker}`;
  }
  return `${quotePosixArgument(process.execPath)} ${quotePosixArgument(scriptPath)} ${marker}`;
}

/** True if any hook group for `event` already runs the given Seorak bin script.
 *  Matched by bin-FILENAME (not the full path) so a relocated checkout still
 *  reads as "present" rather than double-installing. */
export function hasSeorakHook(settings: unknown, event: string, binFile: string): boolean {
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks;
  const groups = hooks && typeof hooks === "object" ? (hooks as Record<string, unknown>)[event] : undefined;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) =>
      g &&
      typeof g === "object" &&
      Array.isArray((g as { hooks?: unknown }).hooks) &&
      (g as { hooks: unknown[] }).hooks.some(
        (h) =>
          typeof (h as { command?: unknown })?.command === "string" &&
          seorakCommandPath((h as { command: string }).command, binFile) !== null,
      ),
  );
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let active = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      word += character;
      active = true;
      escaped = false;
      continue;
    }
    if (quote === "'" && character !== "'") {
      word += character;
      active = true;
      continue;
    }
    if (quote === '"' && character !== '"') {
      if (character === "\\") escaped = true;
      else word += character;
      active = true;
      continue;
    }
    if (quote && character === quote) {
      quote = null;
      active = true;
      continue;
    }
    if (!quote && (character === "'" || character === '"')) {
      quote = character;
      active = true;
      continue;
    }
    if (!quote && character === "\\") {
      escaped = true;
      active = true;
      continue;
    }
    if (!quote && /\s/.test(character)) {
      if (active) {
        words.push(word);
        word = "";
        active = false;
      }
      continue;
    }
    word += character;
    active = true;
  }
  if (escaped) word += "\\";
  if (active) words.push(word);
  return words;
}

/** The exact script path a Seorak hook command runs. null when absent. PURE. */
export function seorakCommandPath(command: string, binFile: string): string | null {
  const marker = shellWords(command).find((word) =>
    word.startsWith("--seorak-hook-path="),
  );
  if (marker) {
    try {
      const fileUrl = Buffer.from(
        marker.slice("--seorak-hook-path=".length),
        "base64url",
      ).toString("utf8");
      const path = fileURLToPath(fileUrl);
      return isAbsolute(path) && basename(path) === binFile ? path : null;
    } catch {
      return null;
    }
  }
  return (
    shellWords(command).find(
      (word) => isAbsolute(word) && basename(word) === binFile,
    ) ?? null
  );
}

/**
 * Every Seorak hook binding's script path, per event. PURE — `seorak status`
 * pairs this with an existence check to catch bindings orphaned by a moved
 * checkout (the command still parses as "installed" but the script is gone, so
 * Claude Code fires hooks into ENOENT and capture silently stops).
 */
export function seorakHookPaths(settings: unknown): Array<{ event: string; path: string }> {
  const out: Array<{ event: string; path: string }> = [];
  const hooks = (settings as { hooks?: Record<string, unknown> } | null)?.hooks;
  if (!hooks || typeof hooks !== "object") return out;
  for (const [event, binFile] of Object.entries(EVENT_BINS)) {
    const groups = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const inner = (g as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const cmd = (h as { command?: unknown })?.command;
        if (typeof cmd !== "string") continue;
        const path = seorakCommandPath(cmd, binFile);
        if (path) out.push({ event, path });
      }
    }
  }
  return out;
}

/**
 * Which of the six Seorak events are present in a settings object. PURE — used
 * by `seorak status` to report a 5/6-vs-6/6 checklist without touching disk.
 */
export function presentEvents(settings: unknown): { present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  for (const [event, binFile] of Object.entries(EVENT_BINS)) {
    if (hasSeorakHook(settings, event, binFile)) present.push(event);
    else missing.push(event);
  }
  return { present, missing };
}

/**
 * mergeHooks — PURE. Returns a NEW settings object with the six Seorak bindings
 * merged in (idempotent: an event already running its Seorak bin is left as-is),
 * plus the added/skipped/repaired event lists. Does not mutate the input.
 *
 * `scriptExists` (injected so the merge stays pure) enables SELF-HEAL for a
 * moved checkout: a binding whose script path no longer exists on disk would
 * otherwise read as "already present" forever (the match is by bin FILENAME),
 * leaving Claude Code firing hooks into ENOENT with no way back short of a full
 * uninstall. When every Seorak binding for an event is stale, it is replaced
 * with a fresh binding against the current bin dir and reported as repaired.
 */
export function mergeHooks(
  settings: Record<string, unknown>,
  binDir: string,
  scriptExists?: (path: string) => boolean,
): { settings: Record<string, unknown>; added: string[]; skipped: string[]; repaired: string[] } {
  const next: Record<string, unknown> = { ...settings };
  const hooks: Record<string, unknown> =
    next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)
      ? { ...(next.hooks as Record<string, unknown>) }
      : {};

  /** True when this hook group carries a Seorak command for `binFile` whose
   *  script path is confirmed missing (and none that still resolves). */
  const groupIsStale = (group: unknown, binFile: string): boolean => {
    if (!scriptExists) return false;
    const inner = (group as { hooks?: unknown })?.hooks;
    if (!Array.isArray(inner)) return false;
    let sawSeorak = false;
    for (const h of inner) {
      const cmd = (h as { command?: unknown })?.command;
      if (typeof cmd !== "string") continue;
      const path = seorakCommandPath(cmd, binFile);
      if (!path) continue;
      sawSeorak = true;
      if (path && scriptExists(path)) return false;
    }
    return sawSeorak;
  };

  const added: string[] = [];
  const skipped: string[] = [];
  const repaired: string[] = [];
  for (const [event, binFile] of Object.entries(EVENT_BINS)) {
    const command = commandFor(binFile, binDir);
    let existing = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    if (hasSeorakHook({ hooks }, event, binFile)) {
      const kept = existing.filter((g) => !groupIsStale(g, binFile));
      if (kept.length !== existing.length && !hasSeorakHook({ hooks: { [event]: kept } }, event, binFile)) {
        existing = kept;
        existing.push({ hooks: [{ type: "command", command }] });
        repaired.push(event);
      } else {
        skipped.push(event);
      }
    } else {
      existing.push({ hooks: [{ type: "command", command }] });
      added.push(event);
    }
    hooks[event] = existing;
  }
  next.hooks = hooks;
  return { settings: next, added, skipped, repaired };
}

/**
 * stripHooks — PURE inverse of mergeHooks. Removes only the hook groups whose
 * command runs a Seorak bin script, leaving any non-Seorak hooks (and the rest of
 * settings) intact. Drops an event key entirely if it becomes empty. Returns a new
 * settings object plus the removed event list.
 */
export function stripHooks(settings: Record<string, unknown>): {
  settings: Record<string, unknown>;
  removed: string[];
} {
  const next: Record<string, unknown> = { ...settings };
  const removed: string[] = [];
  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) {
    return { settings: next, removed };
  }
  const hooks: Record<string, unknown> = { ...(next.hooks as Record<string, unknown>) };

  for (const [event, binFile] of Object.entries(EVENT_BINS)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => {
      const inner = (g as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) return true;
      // Drop a group if ANY of its commands runs a Seorak bin for this event.
      const isSeorak = inner.some((h) => {
        const cmd = (h as { command?: unknown })?.command;
        return (
          typeof cmd === "string" &&
          seorakCommandPath(cmd, binFile) !== null
        );
      });
      return !isSeorak;
    });
    if (kept.length !== groups.length) removed.push(event);
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;
  return { settings: next, removed };
}

/** Read + parse the settings file. Throws on malformed JSON / non-object. */
function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (err) {
    throw new Error(`${settingsPath} is not valid JSON (${(err as Error).message}); fix or move it first.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${settingsPath} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** Write settings, creating the parent dir and backing up an existing file. */
function writeSettings(settingsPath: string, settings: Record<string, unknown>): boolean {
  mkdirSync(dirname(settingsPath), { recursive: true });
  let backedUp = false;
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, `${settingsPath}.bak`);
    backedUp = true;
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return backedUp;
}

/**
 * installHooks — read → merge → (backup +) write. Idempotent: a fully-installed
 * file is left untouched (no .bak churn) and returns added=[]. Verifies the hook
 * scripts exist before touching settings. Throws on malformed/missing scripts.
 */
export function installHooks(options: InstallOptions = {}): InstallResult {
  const settingsPath = options.settingsPath ?? defaultSettingsPath();
  const binDir = options.binDir ?? defaultBinDir();

  for (const binFile of new Set(Object.values(EVENT_BINS))) {
    if (!existsSync(join(binDir, binFile))) {
      throw new Error(`missing hook script: ${join(binDir, binFile)} — run from a full checkout.`);
    }
  }

  const current = readSettings(settingsPath);
  const { settings, added, skipped, repaired } = mergeHooks(
    current,
    binDir,
    existsSync,
  );
  if (added.length === 0 && repaired.length === 0) {
    return { added, skipped, removed: [], repaired, settingsPath, backedUp: false };
  }
  const backedUp = writeSettings(settingsPath, settings);
  return { added, skipped, removed: [], repaired, settingsPath, backedUp };
}

/**
 * removeHooks — read → strip → (backup +) write. Idempotent: a file with no
 * Seorak hooks is left untouched and returns removed=[].
 */
export function removeHooks(options: InstallOptions = {}): InstallResult {
  const settingsPath = options.settingsPath ?? defaultSettingsPath();
  if (!existsSync(settingsPath)) {
    return { added: [], skipped: [], removed: [], repaired: [], settingsPath, backedUp: false };
  }
  const current = readSettings(settingsPath);
  const { settings, removed } = stripHooks(current);
  if (removed.length === 0) {
    return { added: [], skipped: [], removed, repaired: [], settingsPath, backedUp: false };
  }
  const backedUp = writeSettings(settingsPath, settings);
  return { added: [], skipped: [], removed, repaired: [], settingsPath, backedUp };
}
