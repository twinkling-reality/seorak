#!/usr/bin/env node
/**
 * install-hooks.mjs — register the Seorak collector hooks in Claude Code.
 *
 * Thin wrapper around src/install.ts (the shared module reused by the `seorak`
 * CLI). Idempotently MERGES the six hook bindings into ~/.claude/settings.json
 * (preserving any hooks you already have) so Claude Code appends session/tool
 * events to the collector log. Run once per machine after cloning.
 *
 *   node packages/collector/scripts/install-hooks.mjs           # write (backs up first)
 *   node packages/collector/scripts/install-hooks.mjs --print   # dry run, print only
 *
 * Target file: $SEORAK_SETTINGS, else ~/.claude/settings.json.
 *
 * The six bindings (PostToolUse and PostToolUseFailure are SEPARATE Claude Code
 * events — both must be bound or failed tool calls go uncounted and the error
 * rate silently undercounts):
 *   SessionStart        -> hook-session-start.mjs
 *   PostToolUse         -> hook-tool-use.mjs   (success: errored=false)
 *   PostToolUseFailure  -> hook-tool-use.mjs   (failure: errored=true)
 *   SessionEnd          -> hook-session-end.mjs
 *   Notification        -> hook-notification.mjs (needs-you signal)
 *   UserPromptSubmit    -> hook-user-prompt.mjs (steering cadence, envelope-only)
 *
 * Requires Node >= 22.18 (native TypeScript type-stripping; the .mjs hooks import
 * the collector's .ts sources directly).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_BINS,
  defaultSettingsPath,
  installHooks,
  mergeHooks,
} from "../src/install.ts";

const binDir = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
const settingsPath = defaultSettingsPath();
const printOnly = process.argv.includes("--print");

// Verify the bin scripts exist before touching settings (matches installHooks,
// but checked here too so --print fails loudly on a partial checkout).
for (const binFile of new Set(Object.values(EVENT_BINS))) {
  if (!existsSync(join(binDir, binFile))) {
    console.error(`✘ missing hook script: ${join(binDir, binFile)} (run from a full checkout)`);
    process.exit(1);
  }
}

if (printOnly) {
  let current = {};
  if (existsSync(settingsPath)) {
    try {
      current = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (err) {
      console.error(`✘ ${settingsPath} is not valid JSON (${err.message}); fix or move it first.`);
      process.exit(1);
    }
  }
  const { settings, added, skipped } = mergeHooks(current, binDir);
  console.log(`# dry run: would write ${settingsPath}\n`);
  console.log(JSON.stringify(settings, null, 2));
  console.log(`\n# add: ${added.join(", ") || "(none)"} | already present: ${skipped.join(", ") || "(none)"}`);
  process.exit(0);
}

let result;
try {
  result = installHooks({ settingsPath, binDir });
} catch (err) {
  console.error(`✘ ${err.message}`);
  process.exit(1);
}

if (result.added.length === 0) {
  console.log(`✓ all six Seorak hooks already registered in ${settingsPath}, nothing to do.`);
  process.exit(0);
}

if (result.backedUp) console.log(`• backed up existing settings to ${settingsPath}.bak`);
console.log(`✓ wrote ${settingsPath}`);
console.log(`  added:   ${result.added.join(", ")}`);
console.log(`  skipped: ${result.skipped.join(", ") || "(none)"}`);
console.log(`\nRestart Claude Code (or start a new session) for the hooks to take effect.`);
