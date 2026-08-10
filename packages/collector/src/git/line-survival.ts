/**
 * git/line-survival.ts — on-branch LINE-survival (WS3 / OUTCOME-ATTRIBUTION):
 * resolve a LIVE ref that CONTAINS the session's work, then blame each attributed
 * file against the commit it was attributed to.
 *
 * PRIVACY: `git blame --porcelain` is the densest content surface in the collector
 * (line text, author, email, commit message, path). All of it is consumed here and
 * DISCARDED; callers receive counts plus a closed-enum fate. Every value that reaches
 * an event is magnitude- or enum-checked again at emit time (emit.ts).
 */
import type { LineSurvivalFate } from "@seorak/types";
import { defaultBranch } from "./repo-state.ts";
import { git, runGitStatus } from "./runner.ts";

/**
 * Is `sha` an ancestor of (reachable from) `ref`? Three honest outcomes:
 *   - true  → the commit is on that ref's line (the work is there).
 *   - false → the object is GONE, or it exists but is not an ancestor (reverted,
 *             reset, rebased away).
 *   - null  → git could not be consulted (timeout/missing binary) — the caller
 *             retries rather than grading, so a flaky read never reports a rewrite.
 *
 * `merge-base --is-ancestor` (exit 0 ⇒ ancestor, exit 1 ⇒ not) with a `cat-file -e`
 * existence pre-check, so a missing object is a clean false rather than a merge-base
 * error — which `git()` would collapse to null and make indistinguishable from a
 * timeout.
 */
function isAncestorOf(cwd: string, sha: string, ref: string): boolean | null {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  const exists = runGitStatus(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (exists === null) return null;
  if (exists !== 0) return false; // object no longer present → not reachable
  const ancestor = runGitStatus(cwd, ["merge-base", "--is-ancestor", sha, ref]);
  if (ancestor === null) return null;
  return ancestor === 0;
}

/** Hard ceiling on touched files a single sweep will blame — bounds the per-tick
 *  cost (R10); a session over the cap resolves to `unknown` (excluded), never a
 *  biased partial count. */
const LINE_SURVIVAL_FILE_CAP = 100;

/** Hard ceiling on commits probed when hunting for a live ref that contains the
 *  session's work (HEAD-TO-HEAD ADR-H0) — bounds the per-sweep git cost when a
 *  session landed a long series. rev-list yields newest-first, and ANY one of the
 *  session's commits being on a live ref proves the work is there, so the newest
 *  few are a sufficient probe. */
const SURVIVAL_REF_PROBE_CAP = 5;

/**
 * The tip sha of `ref`, three ways: a 40-hex string when the ref exists,
 * `undefined` when it does NOT (a clean negative — the ref was deleted), and `null`
 * when git could not be consulted at all (transient). Mirrors runGitStatus' 3-way
 * honesty, which the `git()` reader collapses and which matters here: a deleted
 * branch and a timed-out git call must lead to different outcomes.
 */
function resolveRefTip(cwd: string, ref: string): string | null | undefined {
  const status = runGitStatus(cwd, ["rev-parse", "--verify", "--quiet", ref]);
  if (status === null) return null; // could not run git → transient
  if (status !== 0) return undefined; // no such ref → clean negative
  const tip = git(cwd, ["rev-parse", "--verify", ref]);
  if (tip === null || !/^[0-9a-f]{7,40}$/.test(tip)) return null;
  return tip;
}

/** Is ANY of `shas` an ancestor of `tip`? true / false / null (nothing could be
 *  determined). A sha whose ancestry read fails is SKIPPED rather than counted as a
 *  miss, so one flaky git call never turns a live ref into a false negative. */
function anyAncestorOf(cwd: string, shas: string[], tip: string): boolean | null {
  let anyKnown = false;
  for (const sha of shas) {
    const r = isAncestorOf(cwd, sha, tip);
    if (r === null) continue; // this sha unknown → skip, don't grade
    anyKnown = true;
    if (r) return true;
  }
  return anyKnown ? false : null;
}

/**
 * Every ref that CONTAINS `sha` — local branches first, then remote-tracking
 * (deterministic order; origin/HEAD's symbolic alias filtered out so it cannot
 * duplicate its target). `[]` when nothing contains it, INCLUDING when the object
 * itself is gone (a clean "nowhere"); `null` only when git could not be consulted.
 *
 * The existence pre-check matters: `git branch --contains <missing-sha>` exits
 * non-zero, which `git()` collapses to null — indistinguishable from a timeout. A
 * rewritten-away commit would then look transient and wedge the entry pending
 * forever instead of resolving honestly to `unreachable`.
 */
function refsContaining(cwd: string, sha: string): string[] | null {
  const exists = runGitStatus(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (exists === null) return null; // could not run git → transient
  if (exists !== 0) return []; // object gone → no ref contains it
  const out = git(cwd, ["branch", "-a", "--contains", sha, "--format=%(refname)"]);
  if (out === null) return null;
  const refs = out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("refs/"));
  return [
    ...refs.filter((r) => r.startsWith("refs/heads/")),
    ...refs.filter((r) => r.startsWith("refs/remotes/") && !r.endsWith("/HEAD")),
  ];
}

interface SurvivalRef {
  ref: string;
  tip: string;
}

/**
 * resolveSurvivalRef(cwd, branch, shas) — the LIVE ref to measure line-survival
 * against (HEAD-TO-HEAD ADR-H0, superseding OUTCOME-ATTRIBUTION ADR-OA1b).
 *
 * Survival asks "does this work still EXIST?" — a property of the repo, not of a
 * branch name we happened to write down at session start. A branch deleted after
 * its merge is the NORMAL end state of healthy work: the commits live on in
 * whatever it merged into. Measuring against the remembered branch name therefore
 * reported `unknown` for work that plainly survived — MEASURED on this machine
 * 2026-07-12: 12 of 23 pending records, and 61 sessions / 113,950 authored lines /
 * 407 landed commits across the historical log. So a gone branch is a LOOKUP STEP
 * here, never a fate.
 *
 * Precedence — the first LIVE ref that CONTAINS any of the session's commits wins:
 *   1. the recorded session branch (identical behaviour when it still exists)
 *   2. the repo's default branch (origin/HEAD's target, else main, else master)
 *   3. any other containing ref — local branches before remote-tracking
 *
 * Returns:
 *   - SurvivalRef    the ref + its current tip, guaranteed to contain the work
 *   - "unreachable"  NO live ref contains it (the genuine rewrite family: squash,
 *                    rebase, reset). Excluded from the rate, never graded as death.
 *   - null           git could not be consulted (TRANSIENT → the caller retries)
 *
 * A detached-HEAD start (branch === null) is no longer fatal: its commits are found
 * via steps 2-3 like any others.
 */
function resolveSurvivalRef(
  cwd: string,
  branch: string | null,
  shas: string[],
): SurvivalRef | "unreachable" | null {
  const probes = shas.slice(0, SURVIVAL_REF_PROBE_CAP);
  if (probes.length === 0) return "unreachable";

  // Steps 1 + 2: the named candidates, in precedence order.
  const named: string[] = [];
  if (branch) named.push(`refs/heads/${branch}`);
  const fallback = defaultBranch(cwd);
  if (fallback) {
    const ref = `refs/heads/${fallback}`;
    if (!named.includes(ref)) named.push(ref);
  }

  // Any git call that could not RUN sets this, so a total-failure sweep retries
  // rather than declaring work rewritten away on the strength of a timeout.
  let transient = false;

  for (const ref of named) {
    const tip = resolveRefTip(cwd, ref);
    if (tip === null) {
      transient = true;
      continue;
    }
    if (tip === undefined) continue; // ref deleted → fall through to the next candidate
    const contains = anyAncestorOf(cwd, probes, tip);
    if (contains === null) {
      transient = true;
      continue;
    }
    if (contains) return { ref, tip };
  }

  // Step 3: any other ref that contains the work.
  for (const sha of probes) {
    const refs = refsContaining(cwd, sha);
    if (refs === null) {
      transient = true;
      continue;
    }
    for (const ref of refs) {
      if (named.includes(ref)) continue; // already probed above
      const tip = resolveRefTip(cwd, ref);
      if (tip === null) {
        transient = true;
        continue;
      }
      if (tip === undefined) continue;
      return { ref, tip };
    }
  }

  // Nothing contains the work. Only call that a REWRITE if git actually answered
  // every question we asked; otherwise leave the entry pending for a clean retry.
  return transient ? null : "unreachable";
}

export interface LineSurvivalResult {
  fate: LineSurvivalFate;
  /** Authored lines still surviving on-branch (0 for unreachable/unknown). */
  linesSurviving: number;
  /** Attributed files absent at the ref. Their lines count 0 surviving — right for a
   *  deletion, an UNDER-count for a move. Surfaced so the bias is visible. */
  filesGoneFromTip: number;
}

export interface AttributedBlame {
  linesSurviving: number;
  filesGoneFromTip: number;
}

/**
 * blameAttributedLines(cwd, ref, byFile) — count how many lines at `ref` still blame to
 * the commit that this session was credited with FOR THAT FILE.
 *
 * The per-file sha set is the point, and it is what the old global-set blame got wrong.
 * A session credited with `(C1, a.ts)` and `(C2, b.ts)` must NOT get credit for a line in
 * `a.ts` that blames to `C2` — `C2` touched `a.ts` too, but that file was attributed to
 * someone else, or to nobody. Blaming against one flat set of the session's shas would
 * count it anyway, quietly inflating survival for exactly the multi-agent commits Tier 2
 * exists to measure.
 *
 * `git blame --line-porcelain -M -C -w`: `-M -C` follow moves/copies so a refactor is not
 * a false death, `-w` so a whitespace-only reformat is not either. A path ABSENT at `ref`
 * contributes 0 and increments `filesGoneFromTip` (its lines really are gone from that
 * path) — distinguished from a transient git failure (→ null, caller retries) by an
 * existence pre-check, so a deleted file never wedges an entry pending forever.
 *
 * COUNTS only; the blame output (line text, author, email, commit message, path) is
 * consumed here and DISCARDED.
 */
export function blameAttributedLines(
  cwd: string,
  ref: string,
  byFile: Map<string, Set<string>>,
): AttributedBlame | null {
  let linesSurviving = 0;
  let filesGoneFromTip = 0;

  for (const [file, shas] of byFile) {
    const present = runGitStatus(cwd, ["cat-file", "-e", `${ref}:${file}`]);
    if (present === null) return null; // git could not run → transient
    if (present !== 0) {
      filesGoneFromTip += 1; // path absent at the tip → its lines are gone
      continue;
    }
    const out = git(cwd, ["blame", "--line-porcelain", "-M", "-C", "-w", ref, "--", file]);
    if (out === null) return null; // present but blame failed → transient
    for (const line of out.split("\n")) {
      const m = /^([0-9a-f]{40}) /.exec(line);
      if (m && shas.has(m[1]!)) linesSurviving += 1;
    }
  }
  return { linesSurviving, filesGoneFromTip };
}

/**
 * captureAttributedSurvival(cwd, branch, byFile, linesAuthored) — the Tier 2 sweep's
 * classification: resolve a LIVE ref that CONTAINS the work (ADR-H0), then blame each
 * attributed file against the commit it was attributed to.
 *
 * Returns `null` on a TRANSIENT git failure (caller leaves the entry pending and retries),
 * never a guessed value. The three determinable fates stay exactly as they were:
 * `unreachable` when no live ref holds the work (excluded, never graded as death),
 * `overwritten` when the lines existed and none survive, `retained` otherwise.
 */
export function captureAttributedSurvival(
  cwd: string,
  branch: string | null,
  byFile: Map<string, Set<string>>,
  linesAuthored: number,
): LineSurvivalResult | null {
  const shas = new Set<string>();
  for (const set of byFile.values()) for (const sha of set) shas.add(sha);

  if (shas.size === 0) return { fate: "unknown", linesSurviving: 0, filesGoneFromTip: 0 };
  if (byFile.size > LINE_SURVIVAL_FILE_CAP) {
    return { fate: "unknown", linesSurviving: 0, filesGoneFromTip: 0 };
  }
  // Nothing whose persistence can be judged. Excluded as `unknown` rather than mislabeled
  // `overwritten` (which means authored lines EXISTED and were backed out).
  if (linesAuthored === 0) return { fate: "unknown", linesSurviving: 0, filesGoneFromTip: 0 };

  const resolved = resolveSurvivalRef(cwd, branch, [...shas]);
  if (resolved === null) return null; // transient → retry
  if (resolved === "unreachable") {
    // The rewrite family (squash / rebase / reset). The lines may well live on under a
    // NEW sha, but we cannot trace them, so they are EXCLUDED — never credited, and
    // never graded as death.
    return { fate: "unreachable", linesSurviving: 0, filesGoneFromTip: 0 };
  }

  const blamed = blameAttributedLines(cwd, resolved.tip, byFile);
  if (blamed === null) return null; // a blame call could not run → transient
  const linesSurviving = Math.max(0, Math.min(blamed.linesSurviving, linesAuthored));
  return {
    fate: linesSurviving > 0 ? "retained" : "overwritten",
    linesSurviving,
    filesGoneFromTip: blamed.filesGoneFromTip,
  };
}
