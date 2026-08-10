#!/usr/bin/env node

/**
 * Test timeout policy: no vitest suite in this repository may run on vitest's
 * implicit 5000ms default.
 *
 * This docblock is the ONE place the argument lives. The two CI steps and the
 * ownership map's `why` field point here rather than repeating it, because a
 * paragraph copied four times is the same defect as a list copied twice, and
 * this file already argues against that below.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A GATE AND NOT A NUMBER SOMEBODY REMEMBERS TO SET
 * ---------------------------------------------------------------------------
 *
 * MEASURED 2026-08-08, TWICE, ON DIFFERENT TESTS. That is the finding.
 *
 * FIRST OBSERVATION. One commit, unchanged, passed under the root `npm test` and
 * failed under the pre-push full tier with `Error: Test timed out in 5000ms` on
 * the first test of
 * `packages/web/src/views/SettingsView/DeliveryHealthSection.test.tsx`, which
 * calls `vi.resetModules()` and then `await import('./…js')` inside the test
 * body, so a cold module-graph import is charged to the test's own timer.
 *
 * SECOND OBSERVATION, six consecutive runs at loadavg 72-98. The failure moved.
 * It landed on
 * `src/marketing/pages/developers/__tests__/developerDocs.test.tsx > developer
 * documentation never exposes private write authority or credential formats` at
 * 5636ms — a test that is NOT first in its file and is SYNCHRONOUS, so no
 * import-time story explains it at all.
 *
 * THE HONEST CONCLUSION, and it is not the first one anybody reaches: the cause
 * is that a 5000ms budget is smaller than what a contended machine costs. The
 * first-test import penalty is ONE CONTRIBUTOR, measured at a median 8.7x the
 * median of the rest of its file, and it is not the mechanism. Neither
 * observation is the whole story on its own and neither is discarded here.
 *
 * THE SPREAD IS 2.87x, AND IT IS THE WEB SUITE'S OWN. On unchanged web code the
 * worst single test ranged 1965ms at loadavg ~20 to 5636ms at loadavg 91.5 on 12
 * cores. It is not monotonic in load average either: loadavg 97.3 peaked at
 * 2154ms while 91.5 peaked at 5636ms, so instantaneous contention beats the
 * one-minute reading and nothing here is predictable from a load number.
 * `packages/collector` separately measured 5x, but that is a suite that spawns
 * real git, and its ratio is a property of that suite rather than of this
 * machine. Each workspace's config cites its own measurement.
 *
 * AND THERE IS NO SECOND CAUSE, which a reader will assume from the collector
 * precedent because that one was shared state. An exhaustive search of the web
 * suite found none: no environment writes, no spawn, no port binding, no
 * repository writes, and vitest runs it `isolate: true` with `pool: forks`, so
 * every file already has its own process. This defect has one cause. Do not go
 * looking for the other half.
 *
 * That matters more than a slow test would, because the pre-push hook is this
 * project's only automatic check. A flaky timeout there aborts the push, and the
 * cheapest way to make a push succeed is to stop running the check.
 *
 * ---------------------------------------------------------------------------
 * IT DERIVES, IT DOES NOT LIST
 * ---------------------------------------------------------------------------
 *
 * There is deliberately no list of workspaces here, and no list of workspace
 * ROOTS either. This repository has three times paid for a second copy of a
 * list: a duplicated public file set drifted 37 files with both gates green,
 * eleven gates shipped reachable only through a script CI never ran, and a
 * hand-written CI step list drifted from the root test script in both
 * directions.
 *
 * The authoritative list is `workspaces` in the root package.json, so that is
 * what this reads, globs expanded. An earlier draft hard-coded
 * `["packages", "apps"]`, which was a second copy of exactly the kind this
 * paragraph refuses: `tools/runner` and `packages/group/sub` would both have run
 * vitest on the default, invisibly, and the gate would have said so was fine.
 *
 * A workspace is in scope when ANY of its npm scripts invokes vitest. Scanning
 * every script rather than only `test` is a strict superset of the rule and
 * costs nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A FLOOR AND A CEILING, AND WHY THEY ARE THESE
 * ---------------------------------------------------------------------------
 *
 * A check that only asks "is a number declared?" would pass `testTimeout: 5000`
 * and reproduce the exact defect it was written for. The observed failures were
 * 5000ms bounds on tests whose own work is one to two seconds, under contention
 * that stretches wall-clock time nearly threefold and unpredictably. A bound
 * meant to catch a HANG has to carry a large multiple of measured runtime, so
 * the floor sits well above anything mistakable for the default:
 * {@link TIMEOUT_FLOOR_MS}.
 *
 * The ceiling exists because a floor alone accepts `3_600_000`, and an hour is
 * not a generous bound, it is the ABSENCE of one: a hung test would hold the
 * suite until something else killed it, which is the failure the bound is for.
 * {@link TIMEOUT_CEILING_MS} admits `packages/collector`'s 60_000 five times
 * over and still refuses a number that has stopped bounding anything.
 *
 * BOTH ENDS GOVERN THE CONFIG ONLY. A per-test or per-hook override is judged by
 * the directional rule below instead, and not by these bounds, because a ceiling
 * that reached them would fail correct input: `packages/worker` legitimately
 * carries fourteen `900_000` overrides on scale-budget tests that measure
 * 15034ms on a calm machine.
 *
 * Neither end is a target. A workspace whose measured worst case needs more than
 * the floor should declare more, and say why at the declaration.
 *
 * ---------------------------------------------------------------------------
 * A PER-TEST OVERRIDE MAY RAISE THE GLOBAL AND MAY NOT LOWER IT
 * ---------------------------------------------------------------------------
 *
 * THE DIRECTION IS THE ENTIRE RULE. The workspace global is a hang bound bought
 * once for the whole suite. An override BENEATH it silently re-creates, in one
 * test, the tight bound the global was bought to remove — and nothing at that
 * call site says so, which is how `beforeAll(…, 30_000)` in
 * `packages/web/src/views/SettingsView/SettingsView.test.jsx` came to be the
 * first thing that failed under load after the global went to 60_000. An
 * override ABOVE it is a test that genuinely needs longer, saying so where the
 * reason can be read, which is what `packages/worker`'s scale budgets are. So
 * below fails, at-or-above passes, and nothing is banned.
 *
 * AN EARLIER DRAFT OF THE RULE WAS DECLINED, AND THIS IS NOT THAT RULE. What was
 * declined was "no override below {@link TIMEOUT_FLOOR_MS}", implemented as a
 * `}, <number>)` scan. That scan was measured rather than estimated: repo-wide it
 * was 5.3 percent precise, and 43 percent even when restricted to test paths,
 * because it cannot tell `setTimeout(fn, 260)` in
 * `packages/web/src/components/LiveSessionsTable/LiveSessionsTable.tsx:124` or
 * `}, 80)` in `fieldCallouts.tsx:203` or `}, 5)` in
 * `packages/collector/test/codex-tailer.test.ts:150` from a real `it(…, 260)`.
 * A gate that cannot tell a `setTimeout` from an `it` timeout either fails on
 * correct input or needs an acceptance list, and `check-gate-coverage.mjs`
 * records what acceptance lists cost here: eleven wiring defects would have
 * become eleven permanent entries.
 *
 * WHAT CHANGED IS THE ANCHOR, NOT THE AMBITION. {@link findTimeoutOverrides}
 * anchors on the CALLEE — `it`, `test`, `describe`, `bench` and the four hooks,
 * at an identifier boundary, plus any member chain after it — and then walks
 * bracket by bracket to that call's own argument list. A closing `}, N)` is never
 * looked at, so `setTimeout` is not a near miss that has to be excluded; it is
 * not a call this gate anchors on at all. Measured across this repository the
 * anchor finds every override and nothing else: two in `packages/collector`,
 * fourteen in `packages/worker`, none anywhere else — the one `packages/web` had
 * is the SettingsView hook above, deleted by the change that added this rule —
 * and zero in product source, which {@link testFilesIn} keeps out of reach by
 * scanning only the files each workspace's own vitest `include` selects.
 *
 * ---------------------------------------------------------------------------
 * IT READS SOURCE, IT DOES NOT IMPORT — AND THE SAME RULE GOVERNS THE SCRIPT
 * ---------------------------------------------------------------------------
 *
 * Importing a vite config executes it, which pulls in plugins, a TypeScript
 * loader and whatever the config reads from the environment. That is slow,
 * fragile, and would make a cheap static gate depend on every workspace's build
 * graph resolving. So this reads source instead.
 *
 * A value it cannot resolve with confidence is a FAILURE naming the file and the
 * reason, never a pass. THAT PRINCIPLE APPLIES IN ALL THREE PLACES IT READS — the
 * config, the npm script that invokes vitest, and the test files — and this is
 * the only statement of it. An earlier draft applied it only to the config,
 * which cost three proven false passes:
 *
 *   THE KEY MUST BE INSIDE THE `test` BLOCK. Vitest reads `testTimeout` and
 *   `hookTimeout` only under `test`. A flat scan of the file passed a config
 *   declaring them beside `root:` and `plugins:` — the exact shape of
 *   `packages/web/vitest.config.ts`, and the shape a hurried developer writes —
 *   while real vitest 4.1.8 ran the suite at 5000ms and printed no warning about
 *   the unknown top-level key. Same for the keys under `test.poolOptions.forks`,
 *   under `define`, and under `server`. So the match must lie inside the
 *   `test: {` … matching `}` span at depth zero, found by brace tracking. Finding
 *   the key ANYWHERE ELSE fails and says where: a key in the wrong place is
 *   STRONGER evidence of the bug than its absence, because the author believed
 *   they had set it.
 *
 *   THE COMMAND LINE OVERRIDES THE FILE. `vitest run --testTimeout=1000` beats a
 *   compliant 60_000 config; `--config vitest.slow.config.ts` makes this gate
 *   read one file while vitest reads another; `cd sub && vitest run` makes it
 *   read the wrong directory entirely. All three passed. Rather than follow
 *   them — which means resolving a second config, or a shell — the gate FAILS on
 *   {@link UNRESOLVABLE_FLAGS} and on a `cd` before the invocation, and says
 *   which token it could not account for.
 *
 *   THE MASKER MUST UNDERSTAND REGULAR EXPRESSIONS. An earlier draft argued that
 *   a `/` followed by `/` or `*` could not be a regex, which is true of a
 *   regex's START and says nothing about its interior. `/^https:\/\//`, ordinary
 *   in a vite proxy config, was read as a line comment; and `/[^']/` desynced the
 *   string state machine so that a following commented-out `// testTimeout:
 *   30000` was read as a live declaration — a false pass. {@link maskSource}
 *   lexes regex literals with the previous-significant-token heuristic, and an
 *   unterminated literal at end of file is reported rather than assumed benign.
 *
 *   AND POINTING IT AT TEST FILES COST FOUR MORE, all of them found by running
 *   it over all 541 of this repository's test files rather than by reasoning.
 *   Twelve files reported an unterminated regular expression: eleven on `</div>`,
 *   where the previous-token heuristic read a JSX closing tag as a regex start,
 *   and one on `sPct! / 100`, where it read TypeScript's postfix non-null
 *   assertion as a prefix `!`. `corrupt ? "{not-json" : null` was read as a
 *   quoted property key and kept its body. And `padding: "🙂".repeat(4_100)`
 *   desynced the whole file, because the masker split on code POINTS while the
 *   scan indexed by code UNIT. All four are fixed at {@link maskSource}; each one
 *   is a case where the gate would otherwise have failed on correct input or read
 *   a file one position off for the rest of its length.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Config file names in the order vitest resolves them. Vitest reads its own
 * config first and falls back to the vite config, which is exactly why
 * `packages/web` needed one: its `vite.config.ts` sets `root: dashboard/`, so a
 * fallback run would have looked for tests in the document directory.
 */
export const CONFIG_CANDIDATES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
];

/** Both must be declared. A hook that hangs is as fatal as a test that does. */
export const REQUIRED_KEYS = ["testTimeout", "hookTimeout"];

/**
 * The lowest declared value this gate accepts, in milliseconds.
 *
 * Not a budget. The failure this exists for was a 5000ms bound on roughly a
 * second of work, missed because contention on a 12-core machine stretches
 * wall-clock time about threefold and unpredictably. A hang bound has to sit far
 * enough above measured runtime that ordinary contention cannot reach it, and
 * far enough above 5000 that nothing near the default can pass by declaring a
 * number.
 */
export const TIMEOUT_FLOOR_MS = 20_000;

/**
 * The highest declared value this gate accepts, in milliseconds.
 *
 * A floor alone accepts an hour, and an hour is not a bound. Five times
 * `packages/collector`'s 60_000, which is the largest number in the repository
 * that a measurement argues for.
 *
 * It governs the CONFIG only. A per-test override answers to the directional
 * rule in {@link findTimeoutOverrides} instead, which is what keeps
 * `packages/worker`'s fourteen 900_000 scale-budget overrides working.
 */
export const TIMEOUT_CEILING_MS = 300_000;

/**
 * Vitest flags that move what this gate would have to read, and that it refuses
 * to follow. Following `--config` means resolving a second file; following
 * `--root` or `--dir` means resolving a second directory; `--testTimeout` and
 * `--hookTimeout` beat the config outright. Each was proven to produce a false
 * pass against real vitest.
 */
export const UNRESOLVABLE_FLAGS = [
  "--config",
  "-c",
  "--root",
  "-r",
  "--dir",
  "--testTimeout",
  "--hookTimeout",
];

/** Command wrappers to look through when deciding what a segment runs. */
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);

export class TestTimeoutPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "TestTimeoutPolicyError";
  }
}

/* -------------------------------------------------------------------------
 * Reading the config
 * ---------------------------------------------------------------------- */

/** Identifiers after which a `/` begins a regular expression rather than a division. */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * The source with every comment, string body, template body and regular
 * expression blanked to spaces, newlines preserved, LENGTH UNCHANGED so every
 * index and line number still refers to the original file.
 *
 * Returns `{ masked }` or `{ error }`. An unterminated literal at end of file is
 * an error, not a shrug: it means the lexer lost sync, and a desynced lexer is
 * how a commented-out declaration got read as a live one.
 *
 * A QUOTED PROPERTY KEY SURVIVES, and only where a key can occur: a string
 * followed by `:` whose preceding significant character is `{` or `,`. So
 * `"testTimeout": 30000` still reads, `const doc = '{"testTimeout": 30000}'` does
 * not — that second one was a proven false pass — and `corrupt ? "{not-json" :
 * null` does not either, which the ternary-blind version got wrong in
 * `apps/mobile/test/selfHostAuthority.test.mts:314`.
 *
 * IT SPLITS ON CODE UNITS, NOT CODE POINTS, and that is a fix rather than a
 * detail. `[...source]` yields code POINTS while the scan indexes `source` by
 * code UNIT, so one astral character desynced the two index spaces for the rest
 * of the file: `padding: "🙂".repeat(4_100)` in
 * `packages/worker/test/migration-0024-session-projection-bounds.test.ts:121`
 * left the closing quote unblanked and every later string, comment and regex in
 * that file read one position off.
 */
export function maskSource(source) {
  const chars = source.split("");
  const blank = (from, to) => {
    for (let index = from; index < to; index++) {
      if (chars[index] !== "\n") chars[index] = " ";
    }
  };

  /** Index of the last non-space character before `index`, or -1. */
  const significantBefore = (index) => {
    let back = index - 1;
    while (back >= 0 && /\s/.test(chars[back])) back--;
    return back;
  };

  /**
   * Whether a `/` at `index` opens a regular expression.
   *
   * The two TypeScript/JSX cases below are not hypothetical: without them
   * twelve of this repository's 541 test files reported an unterminated regular
   * expression, which under this gate's own rule is a hard failure on correct
   * input.
   */
  const opensRegex = (index) => {
    const back = significantBefore(index);
    if (back < 0) return true;
    const previous = chars[back];
    if (/[)\]}'"`]/.test(previous)) return false;
    // `</div>` closes a JSX element. `a < /re/` is a comparison against a regular
    // expression, which is not code anybody writes.
    if (previous === "<") return false;
    if (previous === "!") {
      // Postfix `!` is TypeScript's non-null assertion and what follows is a
      // division (`sPct! / 100`); prefix `!` is logical not and what follows may
      // be a regex (`if (!/x/.test(s))`). The character before it tells them apart.
      const before = significantBefore(back);
      return !(before >= 0 && /[)\]\w$'"`]/.test(chars[before]));
    }
    if (/[\w$]/.test(previous)) {
      let start = back;
      while (start >= 0 && /[\w$]/.test(chars[start])) start--;
      return REGEX_KEYWORDS.has(chars.slice(start + 1, back + 1).join(""));
    }
    return true;
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (character === "/" && next === "/") {
      let end = index;
      while (end < source.length && source[end] !== "\n") end++;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      if (close < 0) return { error: "an unterminated block comment reaches end of file" };
      blank(index, close + 2);
      index = close + 2;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          closed = true;
          break;
        }
        cursor++;
      }
      if (!closed) {
        return { error: `an unterminated ${quote === "`" ? "template" : "string"} reaches end of file` };
      }
      // A property key keeps its body; a value loses it. A key can only follow
      // `{` or `,`, which is what tells `{ "a": 1 }` from `cond ? "a" : b`.
      let after = cursor + 1;
      while (after < source.length && /\s/.test(source[after])) after++;
      const owner = significantBefore(index);
      const isPropertyKey =
        quote !== "`" &&
        source[after] === ":" &&
        (owner < 0 || chars[owner] === "{" || chars[owner] === ",");
      if (!isPropertyKey) blank(index + 1, cursor);
      index = cursor + 1;
      continue;
    }

    if (character === "/" && opensRegex(index)) {
      let cursor = index + 1;
      let closed = false;
      let inClass = false;
      while (cursor < source.length) {
        const inner = source[cursor];
        if (inner === "\\") {
          cursor += 2;
          continue;
        }
        if (inner === "\n") break;
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) {
          closed = true;
          break;
        }
        cursor++;
      }
      if (!closed) {
        return { error: "an unterminated regular expression reaches end of line" };
      }
      // Blanked whole, delimiters included: nothing downstream should see `//`.
      blank(index, cursor + 1);
      index = cursor + 1;
      continue;
    }

    index++;
  }

  return { masked: chars.join("") };
}

const TEST_BLOCK = /(?:^|[^\w$.])test["']?\s*:\s*\{/g;

/**
 * The body of the one `test: { … }` object, as `{ start, end }` indices into the
 * masked source, or `{ error }`.
 *
 * More than one is an error rather than a choice. The proven false pass was
 * `process.env.CI ? { test: { testTimeout: 30000 } } : { test: {} }`, where a
 * gate that picked either branch would be right half the time.
 */
export function findTestBlock(masked) {
  TEST_BLOCK.lastIndex = 0;
  const openings = [];
  for (const match of masked.matchAll(TEST_BLOCK)) {
    openings.push(match.index + match[0].length);
  }
  if (openings.length === 0) {
    return { error: "the config declares no `test` block, which is where vitest reads these" };
  }
  if (openings.length > 1) {
    return {
      error: `the config declares ${openings.length} \`test\` blocks, so which one vitest uses cannot be read statically`,
    };
  }

  const start = openings[0];
  let depth = 1;
  for (let index = start; index < masked.length; index++) {
    if (masked[index] === "{") depth++;
    else if (masked[index] === "}") {
      depth--;
      if (depth === 0) return { start, end: index };
    }
  }
  return { error: "the `test` block is never closed" };
}

/** 1-based line number of an index. */
function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** A plain integer literal, numeric separators allowed. */
const INTEGER_LITERAL = /^\d[\d_]*$/;

const CLOSING = { "(": ")", "[": "]", "{": "}" };

/**
 * Index of the delimiter matching the opener at `from` in masked source, or
 * undefined when the nesting never closes or closes in the wrong order.
 *
 * This is the whole reason the new rule below is implementable and the
 * `}, <number>)` scan it replaces was not: knowing which call a closing brace
 * belongs to is bracket matching, and bracket matching over MASKED source is
 * reliable because every brace that lives inside a string, a comment, a template
 * or a regular expression has already been blanked.
 */
export function matchDelimiter(masked, from) {
  const stack = [];
  for (let index = from; index < masked.length; index++) {
    const character = masked[index];
    if (CLOSING[character] !== undefined) stack.push(CLOSING[character]);
    else if (character === ")" || character === "]" || character === "}") {
      if (stack.pop() !== character) return undefined;
      if (stack.length === 0) return index;
    }
  }
  return undefined;
}

/**
 * Top-level argument spans of a call group, given the indices just inside its
 * parentheses. Commas nested in a callback, an array or an object belong to that
 * nesting and do not split.
 */
export function topLevelArguments(masked, start, end) {
  const spans = [];
  let depth = 0;
  let from = start;
  for (let index = start; index < end; index++) {
    const character = masked[index];
    if (CLOSING[character] !== undefined) depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;
    else if (character === "," && depth === 0) {
      spans.push([from, index]);
      from = index + 1;
    }
  }
  spans.push([from, end]);
  return spans
    .map(([open, close]) => ({ start: open, end: close, text: masked.slice(open, close).trim() }))
    .filter((argument) => argument.text.length > 0);
}

/**
 * The value declared for `key`, as `{ value }`, or `{ error }`.
 *
 * The key must sit at depth zero inside the single `test` block. Anywhere else —
 * top level beside `root:`, nested under `poolOptions`, inside `define` — is a
 * failure that says where it found it, because vitest ignores it there and the
 * author thought otherwise.
 */
export function readDeclaredTimeout(source, key) {
  const { masked, error } = maskSource(source);
  if (error !== undefined) return { error: `${error}, so this gate cannot read ${key}` };

  const block = findTestBlock(masked);
  if (block.error !== undefined) return { error: block.error };

  const pattern = new RegExp(`(?:^|[^\\w$.])${key}["']?\\s*:\\s*([^,\\n}]*)`, "g");
  const inside = [];
  const misplaced = [];
  for (const match of masked.matchAll(pattern)) {
    const at = match.index + match[0].indexOf(key);
    if (at < block.start || at > block.end) {
      misplaced.push({ at, where: "outside the `test` block" });
      continue;
    }
    let depth = 0;
    for (let index = block.start; index < at; index++) {
      if (masked[index] === "{") depth++;
      else if (masked[index] === "}") depth--;
    }
    if (depth === 0) inside.push({ at, raw: match[1] });
    else misplaced.push({ at, where: "nested inside `test` rather than being one of its own keys" });
  }

  if (inside.length === 0) {
    if (misplaced.length > 0) {
      const places = misplaced
        .map((entry) => `line ${lineAt(source, entry.at)}, ${entry.where}`)
        .join("; ");
      return {
        error:
          `${key} is declared at ${places}. Vitest reads it only as a direct key of ` +
          `\`test\`, silently ignores it anywhere else, and warns about neither`,
      };
    }
    return { error: `${key} is not declared` };
  }
  if (inside.length > 1) {
    return {
      error: `${key} is declared ${inside.length} times inside the \`test\` block, so which one vitest uses cannot be read statically`,
    };
  }

  const raw = inside[0].raw.trim();
  if (raw.length === 0) return { error: `${key} is declared with no value` };
  if (!/^\d[\d_]*$/.test(raw) || raw.endsWith("_")) {
    return {
      error: `${key} is \`${raw}\`, which is not a plain integer literal; this gate reads source and will not guess what a computed value evaluates to`,
    };
  }
  return { value: Number(raw.replaceAll("_", "")) };
}

/** Indices just past the `:` of every direct `test` key named `key`. */
function directTestKeys(masked, block, key) {
  const pattern = new RegExp(`(?:^|[^\\w$.])${key}["']?\\s*:\\s*`, "g");
  const found = [];
  for (const match of masked.matchAll(pattern)) {
    const at = match.index + match[0].indexOf(key);
    if (at < block.start || at > block.end) continue;
    let depth = 0;
    for (let index = block.start; index < at; index++) {
      if (masked[index] === "{") depth++;
      else if (masked[index] === "}") depth--;
    }
    if (depth === 0) found.push(match.index + match[0].length);
  }
  return found;
}

/**
 * The array of plain string literals a config declares for `key` inside its
 * `test` block, as `{ values }`, or `{ absent: true }`, or `{ error }`.
 *
 * Written for `include` and `exclude`, which decide WHICH FILES the override
 * scan below is allowed to look at. Getting that set wrong in the generous
 * direction would let this gate report a finding against a file vitest never
 * runs; getting it wrong in the other direction is a silent hole. So an element
 * that is not a plain string literal is a failure rather than a skip.
 *
 * Emptiness is checked on the MASKED text, where a string literal is its two
 * quotes and blanks. `"a" + "b"` starts and ends with a quote and would satisfy
 * a regex over the raw text; it cannot satisfy one over the masked text.
 */
export function readDeclaredStringArray(source, key) {
  const { masked, error } = maskSource(source);
  if (error !== undefined) return { error: `${error}, so this gate cannot read ${key}` };

  const block = findTestBlock(masked);
  if (block.error !== undefined) return { error: block.error };

  const found = directTestKeys(masked, block, key);
  if (found.length === 0) return { absent: true };
  if (found.length > 1) {
    return {
      error: `${key} is declared ${found.length} times inside the \`test\` block, so which one vitest uses cannot be read statically`,
    };
  }

  const open = found[0];
  if (masked[open] !== "[") {
    return {
      error: `${key} is not an array literal, and this gate reads source rather than evaluating it`,
    };
  }
  const close = matchDelimiter(masked, open);
  if (close === undefined) return { error: `${key}'s array literal is never closed` };

  const values = [];
  for (const element of topLevelArguments(masked, open + 1, close)) {
    if (!/^(['"])\s*\1$/.test(element.text)) {
      return {
        error:
          `${key} carries the element \`${source.slice(element.start, element.end).trim()}\`, ` +
          `which is not a plain string literal`,
      };
    }
    values.push(source.slice(element.start, element.end).trim().slice(1, -1));
  }
  return { values };
}

/**
 * The spellings of `root` this gate can prove name the config file's own
 * directory, which is the workspace directory the scan already walks.
 */
const OWN_DIRECTORY_ROOTS = new Set(["import.meta.dirname", "__dirname", ".", "./"]);

/**
 * `{ ok: true }` when nothing moves test discovery away from the workspace
 * directory, `{ error }` otherwise.
 *
 * This is the config half of a refusal the command-line half already makes.
 * `--root` and a `cd` before the invocation each fail because they make this
 * gate read one directory while vitest reads another; a `root:` in the config
 * does exactly the same thing to the file scan, so it gets the same answer
 * rather than a silently narrower or wider set of files.
 *
 * `packages/web` declares `root: import.meta.dirname`, which IS the config's own
 * directory, so it is accepted by proof rather than by exception.
 */
export function readDeclaredRoot(source) {
  const { masked, error } = maskSource(source);
  if (error !== undefined) return { error: `${error}, so this gate cannot read root` };

  for (const match of masked.matchAll(/(?:^|[^\w$.])root["']?\s*:\s*([^,\n}]*)/g)) {
    const valueEnd = match.index + match[0].length;
    const raw = source.slice(valueEnd - match[1].length, valueEnd).trim();
    const unquoted = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    if (OWN_DIRECTORY_ROOTS.has(unquoted)) continue;
    return {
      error:
        `root is \`${raw}\` at line ${lineAt(source, match.index)}, which moves where vitest ` +
        `looks for tests. This gate scans the workspace directory and will not follow a ` +
        `redirect, for the same reason it refuses \`--root\` on the command line`,
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------
 * Reading the npm script
 * ---------------------------------------------------------------------- */

/**
 * Command segments of a shell fragment, split on the operators npm scripts use.
 * Subshell parentheses are stripped so `(cd sub && vitest run)` still reads as a
 * `cd` followed by an invocation rather than as a command named `(cd`.
 */
export function commandSegments(script) {
  return script
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((segment) => segment.trim().replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, ""))
    .filter((segment) => segment.length > 0);
}

function tokenize(segment) {
  return segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

/** The command a segment runs, looking through `VAR=x` prefixes and `npx`. */
function commandOf(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][\w]*=/.test(tokens[index])) index++;
  while (index < tokens.length && RUNNERS.has(tokens[index])) index++;
  return { name: tokens[index], argumentsFrom: index + 1 };
}

/**
 * What an npm script does with vitest: `{ invokes, problems }`.
 *
 * `problems` is non-empty when the invocation carries something that would move
 * what vitest reads. The gate does not follow those — it says which token it
 * could not account for and fails, which is the same rule the config half
 * applies to a computed value.
 */
export function analyzeScript(script) {
  if (typeof script !== "string") return { invokes: false, problems: [] };
  const problems = [];
  let invokes = false;
  let changedDirectory;

  for (const segment of commandSegments(script)) {
    const tokens = tokenize(segment);
    const { name, argumentsFrom } = commandOf(tokens);
    if (name === undefined) continue;

    if (name === "cd" || name === "pushd") {
      changedDirectory = segment;
      continue;
    }

    if (!/^(?:[\w./@-]*\/)?vitest$/.test(name)) continue;
    invokes = true;

    if (changedDirectory !== undefined) {
      problems.push(
        `the script runs \`${changedDirectory}\` before vitest, so vitest reads a directory ` +
          `this gate is not looking at`,
      );
    }

    for (const token of tokens.slice(argumentsFrom)) {
      const flag = token.split("=")[0];
      if (UNRESOLVABLE_FLAGS.includes(flag)) {
        problems.push(
          `the invocation carries \`${token}\`, which moves or overrides what vitest reads. ` +
            `This gate reads the workspace's own config and will not follow a redirect`,
        );
      }
    }
  }

  return { invokes, problems };
}

/** Does this shell fragment invoke vitest? */
export function invokesVitest(script) {
  return analyzeScript(script).invokes;
}

/* -------------------------------------------------------------------------
 * Finding the workspaces
 * ---------------------------------------------------------------------- */

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `workspaces` from the root manifest, in either npm spelling. */
export function declaredWorkspaceGlobs(manifest) {
  const declared = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : manifest?.workspaces?.packages;
  return Array.isArray(declared) ? declared : undefined;
}

/** Directories matching one workspace glob, relative to the root, sorted. */
export function expandWorkspaceGlob(repositoryRoot, pattern) {
  const segments = pattern.split("/").filter((segment) => segment.length > 0);
  let current = [""];
  for (const segment of segments) {
    const next = [];
    for (const base of current) {
      const absolute = resolve(repositoryRoot, base);
      if (segment === "**") {
        const walk = (relativePath) => {
          next.push(relativePath);
          const directory = resolve(repositoryRoot, relativePath);
          for (const entry of readdirSync(directory).sort()) {
            if (entry.startsWith(".") || entry === "node_modules") continue;
            const child = relativePath === "" ? entry : `${relativePath}/${entry}`;
            if (statSync(resolve(repositoryRoot, child)).isDirectory()) walk(child);
          }
        };
        if (existsSync(absolute)) walk(base);
        continue;
      }
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue;
      if (segment === "*") {
        for (const entry of readdirSync(absolute).sort()) {
          if (entry.startsWith(".") || entry === "node_modules") continue;
          const child = base === "" ? entry : `${base}/${entry}`;
          if (statSync(resolve(repositoryRoot, child)).isDirectory()) next.push(child);
        }
        continue;
      }
      const child = base === "" ? segment : `${base}/${segment}`;
      if (existsSync(resolve(repositoryRoot, child))) next.push(child);
    }
    current = next;
  }
  return [...new Set(current)].filter((entry) => entry.length > 0).sort();
}

/**
 * Every workspace directory the root manifest declares, as `{ directories }` or
 * `{ error }`. Derived from `workspaces`, never from a list in this file.
 */
export function workspaceDirectories(repositoryRoot = REPO_ROOT) {
  const manifestPath = resolve(repositoryRoot, "package.json");
  if (!existsSync(manifestPath)) {
    return { error: "the repository root has no package.json, so its workspaces cannot be derived" };
  }
  let manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (error) {
    return { error: `the root package.json cannot be parsed: ${error.message}` };
  }
  const globs = declaredWorkspaceGlobs(manifest);
  if (globs === undefined || globs.length === 0) {
    return { error: "the root package.json declares no `workspaces`, so there is nothing to derive" };
  }

  const included = new Set();
  const excluded = new Set();
  for (const pattern of globs) {
    const negated = pattern.startsWith("!");
    const target = negated ? excluded : included;
    for (const directory of expandWorkspaceGlob(repositoryRoot, negated ? pattern.slice(1) : pattern)) {
      target.add(directory);
    }
  }

  const directories = [...included]
    .filter((directory) => !excluded.has(directory))
    .filter((directory) => existsSync(resolve(repositoryRoot, directory, "package.json")))
    .sort();
  return { directories, globs };
}

/**
 * Workspaces that run vitest, as `{ directory, name, scripts, problems }`.
 * `scripts` names the npm scripts that invoke it.
 */
export function vitestWorkspaces(repositoryRoot = REPO_ROOT) {
  const discovered = workspaceDirectories(repositoryRoot);
  if (discovered.error !== undefined) return { error: discovered.error };

  const found = [];
  for (const directory of discovered.directories) {
    const manifestPath = resolve(repositoryRoot, directory, "package.json");
    let manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch (error) {
      found.push({ directory, name: directory, scripts: [], problems: [], unreadable: error.message });
      continue;
    }
    const scripts = [];
    const problems = [];
    for (const [name, script] of Object.entries(manifest.scripts ?? {}).sort()) {
      const { invokes, problems: scriptProblems } = analyzeScript(script);
      if (!invokes) continue;
      scripts.push(name);
      for (const problem of scriptProblems) problems.push(`script \`${name}\`: ${problem}`);
    }
    if (scripts.length === 0) continue;
    found.push({ directory, name: manifest.name ?? directory, scripts, problems });
  }
  return { workspaces: found, globs: discovered.globs };
}

/** The config file vitest would load for a workspace, repo-relative, or undefined. */
export function resolveConfigPath(repositoryRoot, workspaceDirectory) {
  for (const candidate of CONFIG_CANDIDATES) {
    const absolute = resolve(repositoryRoot, workspaceDirectory, candidate);
    if (existsSync(absolute)) return relative(repositoryRoot, absolute);
  }
  return undefined;
}

/* -------------------------------------------------------------------------
 * Finding the files vitest would run
 * ---------------------------------------------------------------------- */

/**
 * Vitest's own defaults, written down because a workspace that declares neither
 * still runs a definite set of files and the scan has to know which.
 * `packages/web` declares `exclude` and no `include`, so both halves are live.
 * Copied from vitest 4.1.8 `configDefaults`; the gate fails loudly rather than
 * silently if a future default stops selecting what it selects, because a
 * workspace whose overrides go unread is a hole and the census in the passing
 * output is what shows the count.
 */
export const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
export const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/**
 * A glob as an anchored regular expression over a `/`-separated relative path,
 * as `{ regex }` or `{ error }`.
 *
 * Hand-written rather than borrowed because this file is a dependency-free gate
 * and because an unsupported construct must FAIL rather than quietly match
 * nothing. It covers what vitest's own defaults and this repository's configs
 * use: `**`, `*`, `?`, `{a,b}`, `[jt]`, and the extglob quantifiers `?()`,
 * `*()`, `+()` and `@()`. A negated extglob is refused.
 */
export function globToRegExp(pattern) {
  if (pattern.startsWith("!")) {
    return { error: `\`${pattern}\` is a negated glob, which this gate does not translate` };
  }
  const escape = (character) => (/[.*+?^${}()|[\]\\]/.test(character) ? `\\${character}` : character);
  const stack = [];
  let source = "^";
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === "\\") {
      source += escape(next ?? "");
      index += 2;
      continue;
    }
    if ("?*+@!".includes(character) && next === "(") {
      if (character === "!") {
        return { error: `\`${pattern}\` uses \`!(\`, a negated extglob this gate does not translate` };
      }
      source += "(?:";
      stack.push({ kind: "ext", close: character === "@" ? ")" : `)${character}` });
      index += 2;
      continue;
    }
    if (character === "{") {
      source += "(?:";
      stack.push({ kind: "brace", close: ")" });
      index += 1;
      continue;
    }
    if (character === "}" || character === ")") {
      const open = stack.pop();
      const expected = character === "}" ? "brace" : "ext";
      if (open === undefined || open.kind !== expected) {
        return { error: `\`${pattern}\` closes a group that was never opened` };
      }
      source += open.close;
      index += 1;
      continue;
    }
    if (character === "," && stack.at(-1)?.kind === "brace") {
      source += "|";
      index += 1;
      continue;
    }
    if (character === "|" && stack.at(-1)?.kind === "ext") {
      source += "|";
      index += 1;
      continue;
    }
    if (character === "[") {
      let cursor = index + 1;
      let negated = false;
      if (pattern[cursor] === "!" || pattern[cursor] === "^") {
        negated = true;
        cursor += 1;
      }
      let body = "";
      if (pattern[cursor] === "]") {
        body += "\\]";
        cursor += 1;
      }
      let closed = false;
      while (cursor < pattern.length) {
        if (pattern[cursor] === "]") {
          closed = true;
          break;
        }
        body += pattern[cursor] === "\\" ? pattern.slice(cursor, cursor + 2) : pattern[cursor];
        cursor += pattern[cursor] === "\\" ? 2 : 1;
      }
      if (!closed) return { error: `\`${pattern}\` has an unclosed character class` };
      source += `[${negated ? "^" : ""}${body}]`;
      index = cursor + 1;
      continue;
    }
    if (character === "*" && next === "*") {
      let cursor = index;
      while (pattern[cursor] === "*") cursor += 1;
      if (pattern[cursor] === "/") {
        // `**/` spans zero or more whole directories, so `**/a` matches `a`.
        source += "(?:[^/]+/)*";
        index = cursor + 1;
      } else {
        source += ".*";
        index = cursor;
      }
      continue;
    }
    if (character === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += escape(character);
    index += 1;
  }

  if (stack.length > 0) return { error: `\`${pattern}\` leaves a group unclosed` };
  try {
    return { regex: new RegExp(`${source}$`) };
  } catch (error) {
    return { error: `\`${pattern}\` does not translate to a pattern: ${error.message}` };
  }
}

/** Compiled globs, as `{ matchers }` or `{ error }`. */
function compileGlobs(patterns) {
  const matchers = [];
  for (const pattern of patterns) {
    const { regex, error } = globToRegExp(pattern);
    if (error !== undefined) return { error };
    matchers.push(regex);
  }
  return { matchers };
}

/**
 * Repo-relative paths of the files a workspace's vitest would run, sorted, as
 * `{ files }` or `{ error }`.
 *
 * This is the ONLY thing the override scan is allowed to read, and it is what
 * keeps product source out of reach: `LiveSessionsTable.tsx` and
 * `fieldCallouts.tsx` are not `*.test.*` files, so no include pattern in this
 * repository selects them and their `setTimeout(fn, 260)` and `setTimeout(fn,
 * 80)` are invisible here rather than excluded by name.
 *
 * The walk skips `node_modules` and dot-directories the way `expandWorkspaceGlob`
 * does, and additionally prunes any directory an `exclude` pattern of the form
 * `…/**` names, so `packages/web` does not descend into `dist-dashboard/`.
 */
export function testFilesIn(repositoryRoot, workspaceDirectory, include, exclude) {
  const included = compileGlobs(include);
  if (included.error !== undefined) return { error: `include: ${included.error}` };
  const excluded = compileGlobs(exclude);
  if (excluded.error !== undefined) return { error: `exclude: ${excluded.error}` };
  const pruned = compileGlobs(
    exclude.filter((pattern) => pattern.endsWith("/**")).map((pattern) => pattern.slice(0, -3)),
  );
  if (pruned.error !== undefined) return { error: `exclude: ${pruned.error}` };

  const files = [];
  const walk = (relativePath) => {
    const absolute = resolve(repositoryRoot, workspaceDirectory, relativePath);
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (pruned.matchers.some((matcher) => matcher.test(child))) continue;
        walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!included.matchers.some((matcher) => matcher.test(child))) continue;
      if (excluded.matchers.some((matcher) => matcher.test(child))) continue;
      files.push(`${workspaceDirectory}/${child}`);
    }
  };
  walk("");
  return { files: files.sort() };
}

/* -------------------------------------------------------------------------
 * Reading a per-test override out of a test file
 * ---------------------------------------------------------------------- */

/** Callees whose timeout argument vitest bounds with `hookTimeout`. */
export const HOOK_CALLEES = ["beforeAll", "beforeEach", "afterAll", "afterEach"];

/** Callees whose timeout argument vitest bounds with `testTimeout`. */
export const TEST_CALLEES = ["it", "test", "describe", "bench"];

/**
 * The anchor. An identifier from either list, at an identifier boundary, NOT
 * preceded by a `.` — which is what keeps `regexp.test(value)` out.
 */
const CALLEE = new RegExp(
  `(?:^|[^\\w$.])(${[...TEST_CALLEES, ...HOOK_CALLEES].join("|")})(?![\\w$])`,
  "g",
);

/**
 * Module-level `const NAME = <integer literal>` bindings, as a name → value map.
 * A name declared more than once maps to undefined, which reads as unresolvable.
 *
 * This exists because `packages/worker/test/overview-scale-equality.test.ts`
 * writes `const SLOW = 900_000;` and then closes five tests with `}, SLOW)`.
 * Those are correct input. Refusing to resolve a single-file integer constant
 * would have failed them, and inlining the number to satisfy a gate would be the
 * gate arguing with the code.
 */
export function integerConstants(masked) {
  const values = new Map();
  const seen = new Set();
  for (const match of masked.matchAll(
    /(?:^|[^\w$.])const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*([^;\n]*)/g,
  )) {
    const [, name, raw] = match;
    const trimmed = raw.trim();
    const resolvable =
      !seen.has(name) && INTEGER_LITERAL.test(trimmed) && !trimmed.endsWith("_");
    seen.add(name);
    values.set(name, resolvable ? Number(trimmed.replaceAll("_", "")) : undefined);
  }
  return values;
}

/** A timeout expression as `{ value }` or `{ error }`. */
function resolveTimeout(raw, constants) {
  if (INTEGER_LITERAL.test(raw) && !raw.endsWith("_")) {
    return { value: Number(raw.replaceAll("_", "")) };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
    const resolved = constants.get(raw);
    if (resolved !== undefined) return { value: resolved, via: raw };
    return {
      error: `\`${raw}\` is not a \`const\` bound once to a plain integer literal in this file`,
    };
  }
  return { error: `\`${raw}\` is not a plain integer literal` };
}

/** A top-level `timeout:` inside an object argument, or undefined. */
function optionsTimeout(masked, argument, constants) {
  const open = masked.indexOf("{", argument.start);
  const close = open < 0 ? undefined : matchDelimiter(masked, open);
  if (close === undefined || close > argument.end) {
    return { error: "an options object argument is never closed" };
  }
  for (const match of masked.slice(open + 1, close).matchAll(/(?:^|[^\w$.])timeout["']?\s*:\s*([^,\n}]*)/g)) {
    const at = open + 1 + match.index + match[0].indexOf("timeout");
    let depth = 0;
    for (let index = open + 1; index < at; index++) {
      const character = masked[index];
      if (CLOSING[character] !== undefined) depth++;
      else if (character === ")" || character === "]" || character === "}") depth--;
    }
    if (depth !== 0) continue;
    return resolveTimeout(match[1].trim(), constants);
  }
  return undefined;
}

/**
 * Every per-test and per-hook timeout override a test file declares, as
 * `{ overrides, problems }`.
 *
 * `overrides` carries `{ line, callee, kind, value, via }`; `problems` carries a
 * site whose timeout is there but unreadable.
 *
 * THE ANCHOR IS THE CALL, NOT ITS TAIL, and that is the whole design. From the
 * callee identifier this walks its member chain — so `it.each`, `it.skip`,
 * `describe.sequential` and `it.concurrent.each` all arrive here — consuming
 * `(…)` groups and tagged-template arguments until the chain ends, and reads the
 * LAST group. `it.each(table)('name', fn, 100)` puts the timeout in the second
 * group, which is why the walk keeps going instead of stopping at the first.
 */
export function findTimeoutOverrides(source) {
  const { masked, error } = maskSource(source);
  if (error !== undefined) return { overrides: [], problems: [error] };

  const constants = integerConstants(masked);
  const overrides = [];
  const problems = [];
  CALLEE.lastIndex = 0;

  for (const match of masked.matchAll(CALLEE)) {
    const name = match[1];
    const nameStart = match.index + match[0].length - name.length;
    let chain = name;
    let cursor = nameStart + name.length;
    let group;

    for (;;) {
      while (cursor < masked.length && /\s/.test(masked[cursor])) cursor++;
      const character = masked[cursor];
      if (character === ".") {
        let from = cursor + 1;
        while (from < masked.length && /\s/.test(masked[from])) from++;
        let to = from;
        while (to < masked.length && /[\w$]/.test(masked[to])) to++;
        if (to === from) break;
        chain += `.${masked.slice(from, to)}`;
        cursor = to;
        continue;
      }
      if (character === "(") {
        const close = matchDelimiter(masked, cursor);
        if (close === undefined) {
          problems.push(`line ${lineAt(source, cursor)}: \`${chain}(\` is never closed`);
          group = undefined;
          break;
        }
        group = { start: cursor + 1, end: close };
        cursor = close + 1;
        continue;
      }
      if (character === "`") {
        const close = masked.indexOf("`", cursor + 1);
        if (close < 0) break;
        cursor = close + 1;
        continue;
      }
      break;
    }

    if (group === undefined) continue;

    const kind = HOOK_CALLEES.includes(name) ? "hook" : "test";
    const parsed = readCallTimeout(masked, group, kind, constants);
    if (parsed === undefined) continue;
    const line = lineAt(source, nameStart);
    if (parsed.error !== undefined) {
      problems.push(`line ${line}: \`${chain}\` declares a timeout this gate cannot read: ${parsed.error}`);
      continue;
    }
    overrides.push({ line, callee: chain, kind, value: parsed.value, via: parsed.via });
  }

  return { overrides, problems };
}

/**
 * The timeout a single call declares, or undefined when it declares none.
 *
 * Two shapes are recognised, and nothing else is guessed at:
 *
 *   AN OPTIONS OBJECT anywhere in the argument list, which is vitest's
 *   `it('x', { timeout: 5000 }, fn)` form. Only a `timeout:` at the object's own
 *   top level counts.
 *
 *   A TRAILING POSITIONAL ARGUMENT, which is a timeout when it begins with a
 *   digit — nothing that begins with a digit is a name, a callback or an options
 *   object — or when it sits where vitest reads one: second for a hook,
 *   `beforeAll(fn, 30_000)`; third for a test whose second argument is not an
 *   options object, `it('x', fn, 30_000)`. The position rule is what catches
 *   `}, SLOW)`, which a digit rule alone would read as a callback.
 *
 * A GROUP WITH ONE ARGUMENT DECLARES NOTHING. No shape vitest accepts carries a
 * timeout without also carrying a body or a name, and the guard is load-bearing
 * rather than defensive: the digit rule alone read the trailing `3` of an
 * uncalled `it.each([1, 2, 3])` as a timeout.
 */
function readCallTimeout(masked, group, kind, constants) {
  const argumentSpans = topLevelArguments(masked, group.start, group.end);
  if (argumentSpans.length < 2) return undefined;

  for (const argument of argumentSpans) {
    if (!argument.text.startsWith("{")) continue;
    const declared = optionsTimeout(masked, argument, constants);
    if (declared !== undefined) return declared;
  }

  const position = kind === "hook" ? 1 : 2;
  const last = argumentSpans.at(-1);
  const atTimeoutPosition =
    argumentSpans.length === position + 1 &&
    (kind === "hook" || !argumentSpans[1].text.startsWith("{"));
  if (!/^\d/.test(last.text) && !atTimeoutPosition) return undefined;
  // An object here has already been offered to the options reader above and
  // carries no `timeout:`, so it is a bench options bag rather than a timeout.
  if (last.text.startsWith("{")) return undefined;
  return resolveTimeout(last.text, constants);
}

/** The declared global a callee's override is measured against. */
const GLOBAL_FOR_KIND = { hook: "hookTimeout", test: "testTimeout" };

/**
 * Every override in a workspace's own test files, measured against its declared
 * globals: `{ overrides, problems }`.
 *
 * The comparison is DIRECTIONAL, and the direction is the whole rule. A global
 * is a hang bound bought once for the suite; an override BELOW it silently
 * re-creates the tight bound the global was bought to remove, in one test, where
 * nothing about the file says so. An override ABOVE it is a test that genuinely
 * needs longer, saying so at the call site where the reason can be read, which
 * is what `packages/worker`'s nine 900_000 scale budgets are.
 */
function inspectOverrides(repositoryRoot, workspace, config, source, values) {
  const problems = [];
  const overrides = [];

  const root = readDeclaredRoot(source);
  if (root.error !== undefined) return { overrides, problems: [`${config}: ${root.error}`] };

  const selectors = {};
  for (const [key, fallback] of [
    ["include", DEFAULT_INCLUDE],
    ["exclude", DEFAULT_EXCLUDE],
  ]) {
    const declared = readDeclaredStringArray(source, key);
    if (declared.error !== undefined) {
      return { overrides, problems: [`${config}: ${declared.error}`] };
    }
    selectors[key] = declared.absent === true ? fallback : declared.values;
  }

  const found = testFilesIn(repositoryRoot, workspace.directory, selectors.include, selectors.exclude);
  if (found.error !== undefined) return { overrides, problems: [`${config}: ${found.error}`] };

  for (const file of found.files) {
    let fileSource;
    try {
      fileSource = readFileSync(resolve(repositoryRoot, file), "utf8");
    } catch (error) {
      problems.push(`${file} cannot be read, and vitest runs it: ${error.message}`);
      continue;
    }
    const scanned = findTimeoutOverrides(fileSource);
    for (const problem of scanned.problems) problems.push(`${file}: ${problem}`);
    for (const override of scanned.overrides) {
      const key = GLOBAL_FOR_KIND[override.kind];
      const global = values[key];
      if (global === undefined) continue;
      overrides.push({ ...override, file, key, global });
      if (override.value >= global) continue;
      problems.push(
        `${file}:${override.line}: \`${override.callee}\` overrides ${key} with ` +
          `${override.value}ms${override.via === undefined ? "" : ` (\`${override.via}\`)`}, below ` +
          `the ${global}ms ${config} declares. A global timeout is a hang bound bought once for ` +
          `the whole suite, so an override beneath it re-creates the tight bound the global was ` +
          `bought to remove, in one place, where nothing says so. Raise it above ${global} if this ` +
          `test truly needs longer, or delete it.`,
      );
    }
  }

  return { overrides, problems };
}

/**
 * One workspace's verdict: `{ workspace, config, values, overrides, problems }`.
 * `values` carries every key that parsed and `overrides` every per-test timeout
 * found, so a passing run can print evidence rather than a checkmark.
 */
export function inspectWorkspace(repositoryRoot, workspace) {
  const problems = [...(workspace.problems ?? []).map((problem) => `${workspace.name}: ${problem}`)];
  const values = {};
  const overrides = [];

  if (workspace.unreadable !== undefined) {
    problems.push(
      `${workspace.directory}/package.json cannot be parsed, and this gate needs it: ${workspace.unreadable}`,
    );
    return { workspace, config: undefined, values, overrides, problems };
  }

  const config = resolveConfigPath(repositoryRoot, workspace.directory);
  if (config === undefined) {
    problems.push(
      `${workspace.name} runs vitest (${workspace.scripts.join(", ")}) and has no config file, ` +
        `so every test in it is bounded at vitest's implicit 5000ms default. ` +
        `Add ${workspace.directory}/${CONFIG_CANDIDATES[0]} declaring ${REQUIRED_KEYS.join(" and ")}.`,
    );
    return { workspace, config, values, overrides, problems };
  }

  let source;
  try {
    source = readFileSync(resolve(repositoryRoot, config), "utf8");
  } catch (error) {
    problems.push(`${config} cannot be read, and this gate needs it: ${error.message}`);
    return { workspace, config, values, overrides, problems };
  }

  for (const key of REQUIRED_KEYS) {
    const declared = readDeclaredTimeout(source, key);
    if (declared.error !== undefined) {
      problems.push(
        `${config}: ${declared.error}. Without a value vitest reads, ${workspace.name} runs on ` +
          `the implicit 5000ms default, which on a contended machine measures contention ` +
          `rather than the code.`,
      );
      continue;
    }
    values[key] = declared.value;
    if (declared.value < TIMEOUT_FLOOR_MS) {
      problems.push(
        `${config}: ${key} is ${declared.value}ms, below the ${TIMEOUT_FLOOR_MS}ms floor. ` +
          `A timeout is a hang bound and must carry a large multiple of measured runtime; ` +
          `a value this close to the default reproduces the failure the floor exists for.`,
      );
    }
    if (declared.value > TIMEOUT_CEILING_MS) {
      problems.push(
        `${config}: ${key} is ${declared.value}ms, above the ${TIMEOUT_CEILING_MS}ms ceiling. ` +
          `A bound that large has stopped bounding anything: a hung test would hold the ` +
          `suite until something else killed it. Declare a hang bound here and override ` +
          `per test, at the call site, where the reason can be read.`,
      );
    }
  }

  const scanned = inspectOverrides(repositoryRoot, workspace, config, source, values);
  overrides.push(...scanned.overrides);
  problems.push(...scanned.problems);

  return { workspace, config, values, overrides, problems };
}

/** Every workspace's verdict plus the flattened problem list. */
export function checkTestTimeouts(repositoryRoot = REPO_ROOT) {
  const discovered = vitestWorkspaces(repositoryRoot);
  if (discovered.error !== undefined) {
    return { results: [], globs: [], problems: [discovered.error] };
  }
  const results = discovered.workspaces.map((workspace) =>
    inspectWorkspace(repositoryRoot, workspace),
  );
  return {
    results,
    globs: discovered.globs,
    problems: results.flatMap((result) => result.problems),
  };
}

/**
 * One evidence line per workspace, plus one per override it found.
 *
 * The override lines are the point. A rule that a per-test override may not go
 * BELOW its workspace's global reads, on a green run, exactly like a rule that
 * bans overrides — until the output names the ones that passed and the number
 * they carry. `packages/worker`'s scale budgets appear here at 900_000 against a
 * 60_000 global, so the direction of the rule is visible rather than asserted.
 */
export function formatEvidence(results) {
  return results.flatMap((result) => {
    const config = result.config ?? "no config";
    const declared = REQUIRED_KEYS.map(
      (key) => `${key} ${result.values[key] ?? "MISSING"}`,
    ).join(", ");
    const overrides = result.overrides ?? [];
    const count =
      overrides.length === 0 ? "no overrides" : `${overrides.length} override(s)`;
    return [
      `  ${result.workspace.name}  ${config}  ${declared}, ${count}`,
      ...overrides.map(
        (override) =>
          `      ${override.file}:${override.line}  ${override.callee}  ` +
          `${override.value}${override.via === undefined ? "" : ` (${override.via})`} ` +
          `>= ${override.key} ${override.global}`,
      ),
    ];
  });
}

export function assertTestTimeouts(repositoryRoot = REPO_ROOT) {
  const { results, problems } = checkTestTimeouts(repositoryRoot);
  if (problems.length === 0) return results;
  throw new TestTimeoutPolicyError(
    `${problems.length} vitest workspace problem(s):\n` +
      problems.map((problem) => `  ! ${problem}`).join("\n") +
      `\nVitest's default is 5000ms and applies wherever a config does not override it. ` +
      `scripts/check-test-timeouts.mjs records the measurement and the reasoning.`,
  );
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMain()) {
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const repositoryRoot = rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT;
  try {
    const { globs } = checkTestTimeouts(repositoryRoot);
    const results = assertTestTimeouts(repositoryRoot);
    console.log(
      `Test timeout policy passed: ${results.length} vitest workspace(s) across ` +
        `${globs.join(", ")}, each declaring ${REQUIRED_KEYS.join(" and ")} inside its ` +
        `\`test\` block between ${TIMEOUT_FLOOR_MS}ms and ${TIMEOUT_CEILING_MS}ms.\n` +
        formatEvidence(results).join("\n"),
    );
  } catch (error) {
    console.error(
      error instanceof TestTimeoutPolicyError
        ? `Test timeout policy failed: ${error.message}`
        : `Test timeout policy failed: ${error.stack ?? error}`,
    );
    process.exitCode = 1;
  }
}
