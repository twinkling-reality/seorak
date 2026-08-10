/**
 * split-characterization.ts — the behavior-preservation instrument for the P2-01
 * collector split of `git.ts` and `emit.ts`.
 *
 * It drives the two layers THROUGH THEIR FACADES across a broad scenario matrix and
 * returns a deterministic text snapshot. `test/fixtures/split-characterization.pin.txt`
 * is that snapshot recorded against the PRE-SPLIT code (via `git archive` into a
 * scratch tree, running this same harness); `split-characterization.test.ts` replays it
 * and requires the result to be byte-identical.
 *
 * Determinism: SEORAK_DIR points at a fresh sandbox pre-seeded with a FIXED salt, every
 * env var the modules read is set explicitly per scenario, and the git fixtures are
 * built by `build-git-fixtures.sh` with pinned author/committer identity and dates.
 * The snapshot is then CANONICALIZED (see `canonicalize`), because a fixture rebuilt at
 * a different path mints different commit shas and therefore different salted ids —
 * 50 of 1,299 lines. Canonicalization replaces each distinct hash with a token in
 * first-appearance order, which preserves the behavioral content (which ids are equal
 * to which) while making the pin independent of where the fixtures were built.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as git from "../../src/git.ts";
import * as emit from "../../src/emit.ts";
import * as paths from "../../src/paths.ts";
import {
  readSessionCursor,
  writeSessionCursor,
} from "../../src/session-cursors.ts";

/** A pinned salt makes every repoId / saltedHash reproducible across runs. */
const FIXED_SALT = "b".repeat(64);

/**
 * Replace every 64-hex salted id and 40-hex git sha with a stable token, numbered in
 * order of first appearance. Two runs against fixtures built at different paths then
 * agree, while a change in WHICH ids are equal still shows up as a diff.
 */
export function canonicalize(snapshot: string): string {
  const seen = new Map<string, string>();
  const token = (raw: string, kind: string): string => {
    let t = seen.get(raw);
    if (t === undefined) {
      t = `<${kind}:${seen.size + 1}>`;
      seen.set(raw, t);
    }
    return t;
  };
  return snapshot
    .replace(/\b[0-9a-f]{64}\b/g, (m) => (m === FIXED_SALT ? m : token(m, "hash")))
    .replace(/\b[0-9a-f]{40}\b/g, (m) => token(m, "sha"));
}

/** Build the deterministic git fixture repos. Returns the root they were built at. */
export function buildFixtures(root: string): string {
  execFileSync(new URL("./build-git-fixtures.sh", import.meta.url).pathname, [root], {
    encoding: "utf8",
  });
  return root;
}

/**
 * Run the whole scenario matrix and return the snapshot. Mutates process.env
 * (SEORAK_DIR and the momentum knobs), so it belongs in its own test file.
 */
export function characterize(fixtureRoot: string, sandboxRoot: string): string {
  rmSync(sandboxRoot, { recursive: true, force: true });
  mkdirSync(sandboxRoot, { recursive: true });
  process.env.SEORAK_DIR = sandboxRoot;
  // Neutralize every env knob the modules read, so a stray value in the ambient shell
  // cannot make one run differ from the other.
  for (const k of [
    "SEORAK_MOMENTUM",
    "SEORAK_MOMENTUM_WINDOW_DAYS",
    "SEORAK_MOMENTUM_IGNORE",
    "SEORAK_DEBUG",
  ]) {
    delete process.env[k];
  }
  writeFileSync(paths.repoSaltPath(), FIXED_SALT, "utf8");

  const out: string[] = [];
  let section = "";
  function sec(name: string): void {
    section = name;
    out.push("", `## ${name}`);
  }
  /** Record one observation. Values are JSON-serialized with sorted keys so object key
   *  order can never make two semantically equal runs differ (or hide a real change). */
  function rec(label: string, value: unknown): void {
    out.push(`${label} = ${stable(value)}`);
  }
  function stable(v: unknown): string {
    return JSON.stringify(v, (_k, val) => {
      if (val instanceof Map) return { __map: [...val.entries()].sort() };
      if (val instanceof Set) return { __set: [...val].sort() };
      if (val && typeof val === "object" && !Array.isArray(val)) {
        return Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)));
      }
      return val;
    });
  }
  /** Run a thunk and record either its value or the exact throw. A characterization
   *  snapshot must pin FAILURE shapes too — that is where a guard lives. */
  function call(label: string, fn: () => unknown): void {
    try {
      rec(label, fn());
    } catch (e) {
      rec(label, { __threw: (e as Error).name, message: (e as Error).message });
    }
  }
  async function callAsync(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      rec(label, await fn());
    } catch (e) {
      rec(label, { __threw: (e as Error).name, message: (e as Error).message });
    }
  }

  const F = (name: string) => join(fixtureRoot, name);
  const REPOS = [
    "plain-dir",
    "clean",
    "no-remote",
    "dirty",
    "detached",
    // Two states at once, so gitContext's ordered chain of checks is pinned by
    // outcome rather than by inspection. See build-git-fixtures.sh section 5b.
    "detached-dirty",
    "dirty-no-remote",
    "empty",
    "history",
    "survival",
  ];

  // ════════════════════════════════════════════════════════════════════════════
  // git.ts — runner + identity
  // ════════════════════════════════════════════════════════════════════════════
  sec("git: gitContext across every precedence branch");
  for (const r of REPOS) call(`gitContext(${r})`, () => git.gitContext(F(r)));
  call("gitContext(nonexistent path)", () => git.gitContext(join(fixtureRoot, "does-not-exist")));

  sec("git: salt + saltedHash determinism");
  call("readOrCreateSalt()", () => git.readOrCreateSalt());
  for (const seed of ["", "a", "session-1|3d", "unicode-\u00e9\u4e2d", "x".repeat(200)]) {
    call(`saltedHash(${JSON.stringify(seed)})`, () => git.saltedHash(seed));
  }

  sec("git: repoIdentity / repoIdentityOrCwd");
  for (const r of REPOS) {
    call(`repoIdentity(${r})`, () => git.repoIdentity(F(r)));
    call(`repoIdentityOrCwd(${r})`, () => git.repoIdentityOrCwd(F(r)));
  }
  // Stability: a second call must return the same ids (the sticky ledger).
  for (const r of ["clean", "history", "plain-dir"]) {
    call(`repoIdentity(${r}) again`, () => git.repoIdentity(F(r)));
  }

  sec("git: repoToplevel / headSha / currentBranch / defaultBranch");
  for (const r of REPOS) {
    call(`repoToplevel(${r})`, () => {
      const t = git.repoToplevel(F(r));
      // The absolute path is machine-specific; pin only whether it resolved and its basename.
      return t === null ? null : t.split("/").pop();
    });
    call(`headSha(${r})`, () => git.headSha(F(r)));
    call(`currentBranch(${r})`, () => git.currentBranch(F(r)));
    call(`defaultBranch(${r})`, () => git.defaultBranch(F(r)));
  }

  sec("git: commitsBetween");
  {
    const shas = execFileSync("git", ["log", "--format=%H"], { cwd: F("clean"), encoding: "utf8" })
      .trim()
      .split("\n");
    const [tip, mid, root] = shas;
    call("commitsBetween(clean, root, tip)", () => git.commitsBetween(F("clean"), root, tip));
    call("commitsBetween(clean, tip, root)", () => git.commitsBetween(F("clean"), tip, root));
    call("commitsBetween(clean, mid, mid)", () => git.commitsBetween(F("clean"), mid, mid));
    call("commitsBetween(clean, '', tip)", () => git.commitsBetween(F("clean"), "", tip));
    call("commitsBetween(clean, bogus, tip)", () => git.commitsBetween(F("clean"), "f".repeat(40), tip));
    call("commitsBetween(plain-dir, root, tip)", () => git.commitsBetween(F("plain-dir"), root, tip));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // git.ts — momentum
  // ════════════════════════════════════════════════════════════════════════════
  sec("git: momentum env resolvers");
  const ENV_CASES: Array<[string, Record<string, string | undefined>]> = [
    ["unset", {}],
    ["MOMENTUM=0", { SEORAK_MOMENTUM: "0" }],
    ["MOMENTUM=1", { SEORAK_MOMENTUM: "1" }],
    ["MOMENTUM=''", { SEORAK_MOMENTUM: "" }],
    ["MOMENTUM=no", { SEORAK_MOMENTUM: "no" }],
    ["WINDOW=1", { SEORAK_MOMENTUM_WINDOW_DAYS: "1" }],
    ["WINDOW=90", { SEORAK_MOMENTUM_WINDOW_DAYS: "90" }],
    ["WINDOW=0", { SEORAK_MOMENTUM_WINDOW_DAYS: "0" }],
    ["WINDOW=-5", { SEORAK_MOMENTUM_WINDOW_DAYS: "-5" }],
    ["WINDOW=abc", { SEORAK_MOMENTUM_WINDOW_DAYS: "abc" }],
    ["WINDOW=''", { SEORAK_MOMENTUM_WINDOW_DAYS: "" }],
    ["WINDOW=7.9", { SEORAK_MOMENTUM_WINDOW_DAYS: "7.9" }],
    ["IGNORE=a,b", { SEORAK_MOMENTUM_IGNORE: "a,b" }],
    ["IGNORE=' x , ,y '", { SEORAK_MOMENTUM_IGNORE: " x , ,y " }],
    ["IGNORE=''", { SEORAK_MOMENTUM_IGNORE: "" }],
    ["IGNORE=,,,", { SEORAK_MOMENTUM_IGNORE: ",,," }],
  ];
  function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
    const keys = ["SEORAK_MOMENTUM", "SEORAK_MOMENTUM_WINDOW_DAYS", "SEORAK_MOMENTUM_IGNORE", "SEORAK_DEBUG"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    try {
      return fn();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  }
  for (const [label, env] of ENV_CASES) {
    call(`momentumEnabled[${label}]`, () => withEnv(env, () => git.momentumEnabled()));
    call(`momentumWindowDays[${label}]`, () => withEnv(env, () => git.momentumWindowDays()));
    call(`momentumIgnoreGlobs[${label}]`, () => withEnv(env, () => git.momentumIgnoreGlobs()));
  }

  sec("git: captureMomentum + the ignore-glob compiler through it");
  const GLOB_SETS: Array<[string, string[]]> = [
    ["defaults", withEnv({}, () => git.momentumIgnoreGlobs() as string[])],
    ["empty", []],
    ["dirOnly", ["dist/"]],
    ["starExt", ["*.ts"]],
    ["multiStar", ["*.gen*.ts"]],
    ["literalBase", ["a.ts"]],
    ["literalFullPath", ["nested/renamed.ts"]],
    ["blankAndWhitespace", ["", "   ", "b.ts"]],
    ["regexMetachars", ["a+b.ts", "x(y).ts", "*.[tj]s"]],
    ["everything", ["*"]],
  ];
  for (const r of ["clean", "history", "dirty", "no-remote", "empty", "plain-dir"]) {
    for (const [gl, globs] of GLOB_SETS) {
      for (const windowDays of [7, 1, 3650]) {
        call(`captureMomentum(${r}, w=${windowDays}, globs=${gl})`, () =>
          git.captureMomentum(F(r), { windowDays, ignoreGlobs: globs }),
        );
      }
    }
  }

  sec("git: buildGitMomentum full event");
  for (const r of REPOS) {
    for (const [label, env] of [
      ["unset", {}],
      ["MOMENTUM=0", { SEORAK_MOMENTUM: "0" }],
      ["WINDOW=1", { SEORAK_MOMENTUM_WINDOW_DAYS: "1" }],
      ["IGNORE=*.ts", { SEORAK_MOMENTUM_IGNORE: "*.ts" }],
    ] as Array<[string, Record<string, string>]>) {
      call(`buildGitMomentum(${r})[${label}]`, () =>
        withEnv(env, () => git.buildGitMomentum(F(r), "sess-1", "evt-1", "2026-01-01T00:00:00.000Z")),
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // git.ts — session delta
  // ════════════════════════════════════════════════════════════════════════════
  sec("git: uncommittedCounts");
  for (const r of REPOS) {
    for (const [gl, globs] of GLOB_SETS) {
      call(`uncommittedCounts(${r}, globs=${gl})`, () => git.uncommittedCounts(F(r), globs));
    }
  }

  sec("git: writeSessionStartGit + captureSessionDelta");
  // (a) no cursor at all -> uncommitted-only delta
  for (const r of REPOS) {
    call(`captureSessionDelta(${r}) no-cursor`, () => git.captureSessionDelta(F(r), `nocursor-${r}`));
  }
  // (b) cursor written, HEAD unmoved
  for (const r of REPOS) {
    const sid = `unmoved-${r}`;
    call(`writeSessionStartGit(${r}) unmoved`, () => git.writeSessionStartGit(sid, F(r)) ?? null);
    call(`cursorFile(${r}) unmoved`, () => {
      try {
        return JSON.parse(readSessionCursor("git", sid) ?? "");
      } catch {
        return null;
      }
    });
    call(`captureSessionDelta(${r}) unmoved`, () => git.captureSessionDelta(F(r), sid));
    // the cursor must be CLEARED by the delta read
    call(`cursorFile(${r}) after delta`, () => {
      try {
        return JSON.parse(readSessionCursor("git", sid) ?? "");
      } catch {
        return "absent";
      }
    });
  }
  // (c) a hand-written cursor whose startSha is a real earlier commit -> commitsLanded > 0
  {
    const shas = execFileSync("git", ["log", "--format=%H"], { cwd: F("clean"), encoding: "utf8" })
      .trim()
      .split("\n");
    const root = shas[shas.length - 1];
    for (const [label, record] of [
      ["realStart", { startSha: root, startGitContext: "clean", startBranch: "main" }],
      ["bogusStart", { startSha: "f".repeat(40), startGitContext: "clean", startBranch: "main" }],
      ["nullStart", { startSha: null, startGitContext: "dirty-at-start", startBranch: null }],
      ["missingFields", {}],
      ["wrongTypes", { startSha: 42, startGitContext: 7, startBranch: [] }],
    ] as Array<[string, unknown]>) {
      const sid = `handwritten-${label}`;
      writeSessionCursor("git", sid, JSON.stringify(record));
      call(`captureSessionDelta(clean)[${label}]`, () => git.captureSessionDelta(F("clean"), sid));
    }
    // an unparseable cursor
    const sid = "handwritten-corrupt";
    writeSessionCursor("git", sid, "{not json");
    call("captureSessionDelta(clean)[corrupt]", () => git.captureSessionDelta(F("clean"), sid));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // git.ts — commit history
  // ════════════════════════════════════════════════════════════════════════════
  sec("git: resolveNumstatPath");
  for (const raw of [
    "src/{old => new}.ts",
    "packages/{web => worker}/x.ts",
    "src/{foo/ => }bar.ts",
    "src/{ => nested/}x.ts",
    "old.ts => new.ts",
    "src/plain.ts",
    "",
    "a => b => c",
    "{a => b}",
    "x/{ => }y",
    "deep/{a/b/ => c/d/}f.ts",
    "no-arrow => ",
    " => leading",
    // The double-slash collapse: it needs the segment AFTER the brace to start with a
    // separator while the replacement is empty (or ends with one). The forms above
    // never produce that, so without these the `.replace(/\/{2,}/g, "/")` is dead
    // weight as far as any snapshot can tell.
    "pkg/{sub => }/file.ts",
    "{a => }/b.ts",
    "pkg/{sub => other/}/file.ts",
    "a/{b => }//c.ts",
  ]) {
    call(`resolveNumstatPath(${JSON.stringify(raw)})`, () => git.resolveNumstatPath(raw));
  }

  sec("git: commitsSince");
  {
    const hist = F("history");
    const shas = execFileSync("git", ["log", "--format=%H"], { cwd: hist, encoding: "utf8" })
      .trim()
      .split("\n");
    const oldest = shas[shas.length - 1];
    const mid = shas[Math.floor(shas.length / 2)];
    const defaults = withEnv({}, () => git.momentumIgnoreGlobs() as string[]);
    // Shas are machine-specific, so pin the SHAPE: per-commit file counts + added lines,
    // in order, with each sha replaced by its index in the walk.
    const shape = (v: unknown) =>
      v === null
        ? null
        : (v as Array<{ sha: string; at: number; files: Array<{ path: string; added: number }> }>).map(
            (c, i) => ({
              i,
              atIsFinite: Number.isFinite(c.at),
              files: c.files.map((f) => ({ path: f.path, added: f.added })),
            }),
          );
    for (const [label, cursor] of [
      ["coldStart(null)", null],
      ["validCursor(oldest)", oldest],
      ["validCursor(mid)", mid],
      ["bogusCursor(40f)", "f".repeat(40)],
      ["shortCursor(abc)", "abc"],
      ["nonHexCursor", "zzzzzzz"],
    ] as Array<[string, string | null]>) {
      for (const fallbackDays of [7, 1, 3650]) {
        for (const [gl, globs] of [
          ["defaults", defaults],
          ["empty", []],
          ["allTs", ["*.ts"]],
        ] as Array<[string, string[]]>) {
          call(`commitsSince(history, ${label}, main, ${gl}, fb=${fallbackDays})`, () =>
            shape(git.commitsSince(hist, cursor, "main", globs, fallbackDays)),
          );
        }
      }
    }
    call("commitsSince(history, null, nonexistent-ref)", () =>
      shape(git.commitsSince(hist, null, "refs/heads/nope", defaults, 7)),
    );
    call("commitsSince(plain-dir, null, main)", () =>
      shape(git.commitsSince(F("plain-dir"), null, "main", defaults, 7)),
    );
    call("commitsSince(empty, null, main)", () =>
      shape(git.commitsSince(F("empty"), null, "main", defaults, 7)),
    );
  }

  sec("git: seedLastCommitAt");
  {
    const defaults = withEnv({}, () => git.momentumIgnoreGlobs() as string[]);
    const shape = (v: unknown) =>
      v === null
        ? null
        : Object.fromEntries(
            Object.entries(v as Record<string, number>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, t]) => [k, Number.isFinite(t) && t > 0]),
          );
    for (const r of ["history", "clean", "survival", "empty", "plain-dir"]) {
      for (const [since, until] of [
        [3650, 0],
        [7, 0],
        [3650, 7],
        [1, 0],
        [0, 0],
      ]) {
        for (const [gl, globs] of [
          ["defaults", defaults],
          ["empty", []],
          ["allTs", ["*.ts"]],
        ] as Array<[string, string[]]>) {
          call(`seedLastCommitAt(${r}, ${since}, ${until}, ${gl})`, () =>
            shape(git.seedLastCommitAt(F(r), since, until, globs)),
          );
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // git.ts — line survival
  // ════════════════════════════════════════════════════════════════════════════
  sec("git: blameAttributedLines + captureAttributedSurvival");
  {
    const surv = F("survival");
    const [survivingSha, overwrittenSha, doomedSha] = readFileSync(
      join(fixtureRoot, "survival-shas"),
      "utf8",
    )
      .trim()
      .split("\n");
    const orphanSha = readFileSync(join(fixtureRoot, "survival-orphan-sha"), "utf8").trim();
    const tip = execFileSync("git", ["rev-parse", "main"], { cwd: surv, encoding: "utf8" }).trim();

    const byFile = (entries: Array<[string, string[]]>) =>
      new Map(entries.map(([f, s]) => [f, new Set(s)]));

    const CASES: Array<[string, Map<string, Set<string>>]> = [
      ["retained(keep.ts)", byFile([["keep.ts", [survivingSha]]])],
      ["overwritten(gone.ts)", byFile([["gone.ts", [overwrittenSha]]])],
      ["fileGone(vanish.ts)", byFile([["vanish.ts", [doomedSha]]])],
      ["mixed", byFile([["keep.ts", [survivingSha]], ["gone.ts", [overwrittenSha]], ["vanish.ts", [doomedSha]]])],
      ["crossFileShaLeak", byFile([["keep.ts", [overwrittenSha]], ["gone.ts", [survivingSha]]])],
      ["emptyMap", byFile([])],
      ["emptyShaSet", byFile([["keep.ts", []]])],
      ["orphanOnly", byFile([["orphan.ts", [orphanSha]]])],
      ["unknownFile", byFile([["never-existed.ts", [survivingSha]]])],
      ["bogusSha", byFile([["keep.ts", ["f".repeat(40)]]])],
    ];
    for (const [label, m] of CASES) {
      call(`blameAttributedLines(survival, tip, ${label})`, () =>
        git.blameAttributedLines(surv, tip, m),
      );
      for (const branch of ["main", null, "no-such-branch", "detached"]) {
        for (const linesAuthored of [0, 1, 3, 1000]) {
          call(
            `captureAttributedSurvival(survival, ${JSON.stringify(branch)}, ${label}, authored=${linesAuthored})`,
            () => git.captureAttributedSurvival(surv, branch, m, linesAuthored),
          );
        }
      }
    }
    // The file cap: 101 files must resolve `unknown` without blaming anything.
    const over = new Map<string, Set<string>>();
    for (let i = 0; i < 101; i++) over.set(`f${i}.ts`, new Set([survivingSha]));
    call("captureAttributedSurvival(survival, main, 101 files, authored=50)", () =>
      git.captureAttributedSurvival(surv, "main", over, 50),
    );
    const atCap = new Map<string, Set<string>>();
    for (let i = 0; i < 100; i++) atCap.set(`f${i}.ts`, new Set([survivingSha]));
    call("captureAttributedSurvival(survival, main, 100 files, authored=50)", () =>
      git.captureAttributedSurvival(surv, "main", atCap, 50),
    );
    // Not a repo at all.
    call("captureAttributedSurvival(plain-dir, main, retained, authored=3)", () =>
      git.captureAttributedSurvival(F("plain-dir"), "main", byFile([["keep.ts", [survivingSha]]]), 3),
    );
    call("blameAttributedLines(plain-dir, tip, retained)", () =>
      git.blameAttributedLines(F("plain-dir"), tip, byFile([["keep.ts", [survivingSha]]])),
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // emit.ts — the emit-safety tripwire
  // ════════════════════════════════════════════════════════════════════════════
  sec("emit: exported registry surface");
  rec("EMIT_ALLOWLIST", emit.EMIT_ALLOWLIST);
  rec("MODEL_ITEM_ALLOWLIST", emit.MODEL_ITEM_ALLOWLIST);
  rec("SESSION_TOKENS_MODEL_ALLOWLIST", emit.SESSION_TOKENS_MODEL_ALLOWLIST);
  rec("CAPABILITIES_ALLOWLIST", emit.CAPABILITIES_ALLOWLIST);
  rec("AGENT_VERSION_SHAPE.source", emit.AGENT_VERSION_SHAPE.source);
  rec("AGENT_VERSION_SHAPE.flags", emit.AGENT_VERSION_SHAPE.flags);
  rec("EmitAllowlistError name", new emit.EmitAllowlistError("x").name);
  rec("EmitAllowlistError instanceof Error", new emit.EmitAllowlistError("x") instanceof Error);

  sec("emit: assertEmitSafe verdicts");
  /** Record the verdict: "ok" or the EXACT error name + message. The message is the
   *  guard's observable behavior and is what a redaction audit reads. */
  function verdict(label: string, event: unknown): void {
    try {
      emit.assertEmitSafe(event);
      out.push(`${label} = ok`);
    } catch (e) {
      out.push(`${label} = ${(e as Error).name}: ${(e as Error).message}`);
    }
  }

  const ENVELOPE = { eventId: "e1", sessionId: "s1", at: "2026-01-01T00:00:00.000Z" };
  const HEX64 = "a".repeat(64);
  const SHA40 = "b".repeat(40);

  // ── envelope-level rejections ──
  verdict("notObject(null)", null);
  verdict("notObject(undefined)", undefined);
  verdict("notObject(array)", []);
  verdict("notObject(string)", "x");
  verdict("notObject(number)", 7);
  verdict("noKind", { ...ENVELOPE });
  verdict("kindNotString", { kind: 7, ...ENVELOPE });
  verdict("unknownKind", { kind: "session.bogus", ...ENVELOPE });
  verdict("kindProtoPollution", { kind: "toString", ...ENVELOPE });
  verdict("kindConstructor", { kind: "constructor", ...ENVELOPE });

  // ── one un-allowlisted key per kind: the core leak test ──
  const CONTENT_KEYS = [
    "prompt",
    "command",
    "file_text",
    "stdout",
    "stderr",
    "file_path",
    "tool_input",
    "tool_response",
    "tool_error",
    "cwd",
    "message",
    "branch",
    "originUrl",
    "__proto__x",
  ];
  const MINIMAL: Record<string, Record<string, unknown>> = {
    "session.start": { kind: "session.start", ...ENVELOPE, repoId: HEX64, repoLabel: "r", agent: "codex" },
    "tool.call": {
      kind: "tool.call",
      ...ENVELOPE,
      toolName: "Bash",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    "session.end": { kind: "session.end", ...ENVELOPE, reason: "clear" },
    "session.notification": { kind: "session.notification", ...ENVELOPE, notificationType: "idle" },
    "git.momentum": {
      kind: "git.momentum",
      ...ENVELOPE,
      repoId: HEX64,
      repoLabel: "r",
      gitContext: "clean",
      windowDays: 7,
      commits: 1,
      filesTouched: 1,
      linesAdded: 1,
      linesDeleted: 0,
      generatedLinesExcluded: 0,
    },
    "session.delta": {
      kind: "session.delta",
      ...ENVELOPE,
      repoId: HEX64,
      repoLabel: "r",
      gitContext: "clean",
      startGitContext: "clean",
      commitsLanded: 1,
      headMoved: true,
      filesTouchedUncommitted: 0,
      linesAddedUncommitted: 0,
      linesDeletedUncommitted: 0,
      generatedLinesExcludedUncommitted: 0,
    },
    "session.linesurvival": {
      kind: "session.linesurvival",
      ...ENVELOPE,
      repoId: HEX64,
      repoLabel: "r",
      gitContext: "clean",
      rung: "3d",
      fate: "retained",
      commitsChecked: 1,
      linesAuthored: 10,
      linesSurviving: 5,
    },
    "repo.toolchain": {
      kind: "repo.toolchain",
      ...ENVELOPE,
      repoId: HEX64,
      repoLabel: "r",
      gitContext: "clean",
      packageManager: "npm",
      framework: null,
    },
    "session.prompt": { kind: "session.prompt", ...ENVELOPE },
    "session.tokens": {
      kind: "session.tokens",
      ...ENVELOPE,
      models: [{ model: "gpt-5-codex", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }],
    },
    "agent.quota": {
      kind: "agent.quota",
      ...ENVELOPE,
      tool: "codex",
      windows: [{ windowMinutes: 300, usedPercent: 12.5, resetsAt: "2026-01-01T05:00:00.000Z" }],
    },
  };
  for (const [kind, base] of Object.entries(MINIMAL)) {
    verdict(`minimal[${kind}]`, base);
    for (const k of CONTENT_KEYS) verdict(`leak[${kind}].${k}`, { ...base, [k]: "SECRET" });
  }

  // ── session.start deep branch ──
  sec("emit: session.start deep validation");
  const START = MINIMAL["session.start"]!;
  for (const caps of [
    undefined,
    {},
    null,
    [],
    "str",
    7,
    { hasTokens: true },
    { hasTokens: false, hasCacheTokens: true, endReason: true },
    { hasTokens: "yes" },
    { hasTokens: 1 },
    { hasTokens: null },
    { cost: "actual" },
    { cost: "estimate" },
    { cost: "none" },
    { cost: "bogus" },
    { cost: true },
    { cost: null },
    { toolResult: "full" },
    { toolResult: "bogus" },
    { duration: "wall" },
    { duration: "bogus" },
    { verification: "full" },
    { verification: "bogus" },
    { costScope: "session" },
    { costScope: "sesion" },
    { usageWindow: "rate" },
    { usageWindow: "rato" },
    { prompt: "leak" },
    { file_path: "/etc/passwd" },
    { hasTokens: true, prompt: "leak" },
  ]) {
    verdict(`start.capabilities=${stable(caps)}`, { ...START, capabilities: caps });
  }
  for (const v of [
    undefined,
    "1.2.3",
    "0.146.0-alpha.3.1",
    "unknown",
    "",
    "x".repeat(64),
    "x".repeat(65),
    "1.2.3 /Users/me/secret",
    "has space",
    "has/slash",
    "тест",
    7,
    null,
    {},
  ]) {
    verdict(`start.agentVersion=${stable(v)}`, { ...START, agentVersion: v });
  }
  for (const v of [undefined, "feature", "fix", "refactor", "chore", "other", "Feature", "feat/x", "", 7, null]) {
    verdict(`start.branchWorkType=${stable(v)}`, { ...START, branchWorkType: v });
  }
  // repoId shape. Pinned because the guard is ASYMMETRIC here and that asymmetry was
  // invisible: session.linesurvival refuses a 40-hex sha as a commit id ("never a
  // sha"), but session.start applies no shape check to repoId at all, so a raw sha
  // passes. That is the pre-split behavior, recorded so it cannot drift silently and so
  // any deliberate fix has to update this pin on purpose.
  for (const v of [
    HEX64,
    SHA40,
    "not-hex",
    "",
    HEX64.toUpperCase(),
    `${HEX64}extra`,
    HEX64.slice(0, 63),
    7,
    null,
    undefined,
  ]) {
    verdict(`start.repoId=${stable(v)}`, { ...START, repoId: v });
  }

  // ── tool.call deep branch ──
  sec("emit: tool.call deep validation");
  const CALL = MINIMAL["tool.call"]!;
  for (const v of [
    "Bash", "Read", "Edit", "Shell", "ApplyPatch", "mcp", "other", "Task", "TodoWrite",
    "mcp__server__verb", "bash", "", undefined, null, 7, "Unknown",
  ]) {
    verdict(`call.toolName=${stable(v)}`, { ...CALL, toolName: v });
  }
  for (const v of [undefined, "typescript", "svelte", "TypeScript", "brainfuck", "", 7, null]) {
    verdict(`call.fileLanguage=${stable(v)}`, { ...CALL, fileLanguage: v });
  }
  for (const v of [undefined, "reset-hard", "restore", "clean", "revert", "reset", "", 7, null]) {
    verdict(`call.undoKind=${stable(v)}`, { ...CALL, undoKind: v });
  }
  for (const v of [
    undefined,
    [],
    [{ model: "m" }],
    [{ model: "m", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costUsd: 0.1 }],
    [{ model: "m", prompt: "leak" }],
    [{ model: "m", file_path: "/x" }],
    [null],
    ["str"],
    [[]],
    {},
    "str",
    Array.from({ length: 8 }, () => ({ model: "m" })),
    Array.from({ length: 9 }, () => ({ model: "m" })),
    Array.from({ length: 64 }, () => ({ model: "m" })),
  ]) {
    verdict(`call.models=${stable(v)}`, { ...CALL, models: v });
  }

  // ── session.tokens deep branch ──
  sec("emit: session.tokens deep validation");
  const TOK = MINIMAL["session.tokens"]!;
  const okModel = { model: "gpt-5-codex", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const v of [
    undefined,
    null,
    {},
    "str",
    [],
    [okModel],
    [{ ...okModel, costUsd: 1 }],
    [{ ...okModel, prompt: "leak" }],
    [null],
    [{ ...okModel, model: "" }],
    [{ ...okModel, model: "a".repeat(64) }],
    [{ ...okModel, model: "a".repeat(65) }],
    [{ ...okModel, model: "-leading-dash" }],
    [{ ...okModel, model: "/Users/me/secret" }],
    [{ ...okModel, model: "gpt 5" }],
    [{ ...okModel, model: 7 }],
    [{ ...okModel, inputTokens: -1 }],
    [{ ...okModel, inputTokens: 1.5 }],
    [{ ...okModel, inputTokens: Number.NaN }],
    [{ ...okModel, inputTokens: Number.POSITIVE_INFINITY }],
    [{ ...okModel, outputTokens: "1" }],
    [{ ...okModel, cacheReadTokens: undefined }],
    [{ model: "m" }],
    Array.from({ length: 8 }, () => okModel),
    Array.from({ length: 9 }, () => okModel),
  ]) {
    verdict(`tokens.models=${stable(v)}`, { ...TOK, models: v });
  }

  // ── agent.quota deep branch ──
  sec("emit: agent.quota deep validation");
  const QUOTA = MINIMAL["agent.quota"]!;
  const okWin = { windowMinutes: 300, usedPercent: 12.5, resetsAt: "2026-01-01T05:00:00.000Z" };
  for (const v of ["codex", "claude-code", "cursor", "", undefined, null, 7]) {
    verdict(`quota.tool=${stable(v)}`, { ...QUOTA, tool: v });
  }
  for (const v of [
    undefined,
    null,
    {},
    "str",
    [],
    [okWin],
    [okWin, { ...okWin, windowMinutes: 10080 }],
    [okWin, okWin, okWin],
    [okWin, okWin, okWin, okWin],
    [{ ...okWin, plan_type: "pro" }],
    [{ ...okWin, limit_id: "premium" }],
    [{ ...okWin, credits: { balance: 5 } }],
    [null],
    ["str"],
    [{ ...okWin, windowMinutes: -1 }],
    [{ ...okWin, windowMinutes: 1.5 }],
    [{ ...okWin, windowMinutes: "300" }],
    [{ ...okWin, usedPercent: -0.1 }],
    [{ ...okWin, usedPercent: 0 }],
    [{ ...okWin, usedPercent: 100 }],
    [{ ...okWin, usedPercent: 100.1 }],
    [{ ...okWin, usedPercent: Number.NaN }],
    [{ ...okWin, usedPercent: Number.POSITIVE_INFINITY }],
    [{ ...okWin, usedPercent: "12" }],
    [{ ...okWin, resetsAt: "not-a-date" }],
    [{ ...okWin, resetsAt: 1234567890 }],
    [{ ...okWin, resetsAt: "" }],
    [{ ...okWin, resetsAt: null }],
  ]) {
    verdict(`quota.windows=${stable(v)}`, { ...QUOTA, windows: v });
  }

  // ── session.linesurvival deep branch ──
  sec("emit: session.linesurvival deep validation");
  const LS = MINIMAL["session.linesurvival"]!;
  for (const [k, vals] of [
    ["commitsChecked", [0, 1, -1, 1.5, "1", null, undefined, Number.NaN]],
    ["linesAuthored", [0, 10, -1, 1.5, "10", null, undefined]],
    ["linesSurviving", [0, 5, 10, 11, -1, 1.5, null, undefined]],
  ] as Array<[string, unknown[]]>) {
    for (const v of vals) verdict(`ls.${k}=${stable(v)}`, { ...LS, [k]: v });
  }
  for (const v of ["retained", "overwritten", "unreachable", "unknown", "dead", "", 7, null, undefined]) {
    verdict(`ls.fate=${stable(v)}`, { ...LS, fate: v });
  }
  for (const v of ["3d", "7d", "", 7, null, undefined]) verdict(`ls.rung=${stable(v)}`, { ...LS, rung: v });
  for (const v of ["clean", "no-repo", "detached", "dirty-at-start", "no-remote", "bogus", "", 7, null, undefined]) {
    verdict(`ls.gitContext=${stable(v)}`, { ...LS, gitContext: v });
  }
  const okCommit = { id: HEX64, added: 10, contested: 2, authored: 5 };
  for (const v of [
    undefined,
    [],
    [okCommit],
    [okCommit, okCommit],
    {},
    "str",
    [null],
    ["str"],
    [[]],
    [{ ...okCommit, id: SHA40 }],
    [{ ...okCommit, id: "A".repeat(64) }],
    [{ ...okCommit, id: "a".repeat(63) }],
    [{ ...okCommit, id: "a".repeat(65) }],
    [{ ...okCommit, id: 7 }],
    [{ ...okCommit, path: "/secret" }],
    [{ ...okCommit, message: "commit msg" }],
    [{ ...okCommit, added: -1 }],
    [{ ...okCommit, added: 1.5 }],
    [{ ...okCommit, authored: 9, contested: 2 }],
    [{ ...okCommit, authored: 8, contested: 2 }],
    [{ id: HEX64, added: 1 }],
    Array.from({ length: 14 }, () => okCommit),
    Array.from({ length: 100 }, () => okCommit),
    Array.from({ length: 101 }, () => okCommit),
  ]) {
    verdict(`ls.commits=${stable(v)}`, { ...LS, commits: v });
  }
  for (const v of [undefined, 0, 3, -1, 1.5, "3", null]) {
    verdict(`ls.filesGoneFromTip=${stable(v)}`, { ...LS, filesGoneFromTip: v });
  }

  // ── repo.toolchain deep branch ──
  sec("emit: repo.toolchain deep validation");
  const TC = MINIMAL["repo.toolchain"]!;
  for (const v of ["npm", "pnpm", "cargo", "gradle", "brew", "", 7, null, undefined]) {
    verdict(`tc.packageManager=${stable(v)}`, { ...TC, packageManager: v });
  }
  for (const v of ["next", "svelte", "spring", "jquery", "", 7, null, undefined]) {
    verdict(`tc.framework=${stable(v)}`, { ...TC, framework: v });
  }
  for (const v of ["clean", "no-repo", "bogus", "", 7, null, undefined]) {
    verdict(`tc.gitContext=${stable(v)}`, { ...TC, gitContext: v });
  }

  // ── git.momentum repoShape deep branch ──
  sec("emit: git.momentum repoShape deep validation");
  const MOM = MINIMAL["git.momentum"]!;
  const okShape = { monorepo: true, sizeBand: "m", ageBand: "mature" };
  for (const v of [
    undefined,
    okShape,
    { ...okShape, monorepo: false },
    {},
    null,
    [],
    "str",
    7,
    { ...okShape, workspaces: "packages/*" },
    { ...okShape, path: "/Users/me" },
    { ...okShape, monorepo: "yes" },
    { ...okShape, monorepo: 1 },
    { ...okShape, sizeBand: "xs" },
    { ...okShape, sizeBand: "xxl" },
    { ...okShape, sizeBand: 7 },
    { ...okShape, ageBand: "new" },
    { ...okShape, ageBand: "ancient" },
    { monorepo: true },
  ]) {
    verdict(`mom.repoShape=${stable(v)}`, { ...MOM, repoShape: v });
  }

  // ── nested containers: the same leak probe the top level already gets ──
  // Each nested container has its own allowlist, and the sections above probe them
  // with a few hand-picked extra keys. That leaves any OTHER key name unpinned:
  // widening a nested allowlist with a name no scenario happens to use is invisible.
  // Driving every nested container with the full CONTENT_KEYS list closes that, so a
  // nested allowlist cannot grow a content-bearing field without a snapshot diff.
  sec("emit: nested container leak probe");
  const NESTED: Array<[string, (extra: Record<string, unknown>) => unknown]> = [
    ["quota.windows[]", (x) => ({ ...QUOTA, windows: [{ ...okWin, ...x }] })],
    ["tokens.models[]", (x) => ({ ...TOK, models: [{ ...okModel, ...x }] })],
    ["momentum.repoShape", (x) => ({ ...MOM, repoShape: { ...okShape, ...x } })],
    [
      "linesurvival.commits[]",
      (x) => ({ ...LS, commits: [{ id: HEX64, added: 10, contested: 2, authored: 5, ...x }] }),
    ],
    [
      "toolchain.capabilities",
      (x) => ({ ...TC, capabilities: { ...(TC.capabilities as object), ...x } }),
    ],
  ];
  for (const [label, build] of NESTED) {
    for (const key of CONTENT_KEYS) {
      verdict(`${label} + ${key}`, build({ [key]: "leak" }));
    }
  }

  // ── cross-kind: a deep branch must not fire for the WRONG kind ──
  sec("emit: deep branches are kind-scoped");
  verdict("end.reason=clear", { kind: "session.end", ...ENVELOPE, reason: "clear" });
  verdict("end.reason=bogus", { kind: "session.end", ...ENVELOPE, reason: "bogus-not-pinned" });
  verdict("notification.type=bogus", { kind: "session.notification", ...ENVELOPE, notificationType: "zzz" });
  verdict("delta.gitContext=bogus", { ...MINIMAL["session.delta"]!, gitContext: "bogus-not-pinned" });
  verdict("momentum.gitContext=bogus", { ...MOM, gitContext: "bogus-not-pinned" });
  verdict("prompt.envelopeOnly", { kind: "session.prompt", ...ENVELOPE });
  verdict("momentum.commits=-1", { ...MOM, commits: -1 });
  verdict("delta.commitsLanded=-1", { ...MINIMAL["session.delta"]!, commitsLanded: -1 });

  return out.join("\n");

}
