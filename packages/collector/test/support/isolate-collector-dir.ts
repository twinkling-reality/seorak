/**
 * The suite-wide guarantee that no two test files share collector state.
 *
 * `collectorDir()` (paths.ts) falls back to `~/.seorak` whenever `SEORAK_DIR` is
 * unset, and that fallback is correct product behavior: it is where a real
 * install keeps its state. It is also, for a test process, a directory shared
 * with every other test file AND with the developer's own running collector.
 * Measured on 2026-08-05: five files reached it, and the suite wrote
 * `history.sqlite`, `repo-salt`, `repo-identity.json`, and `last-seen-version`
 * into the live `~/.seorak` of the machine running it.
 *
 * That is not a slow test, it is an incorrect one. `repo-salt` and
 * `last-seen-version` are read-modify-write files whose CONTENT selects a
 * branch, so two files racing on one copy do not time out, they observe each
 * other and assert the wrong value, and they can equally well pass when they
 * should fail. `repo-identity.json` is worse than either: paths.ts documents it
 * as a ledger that is not a throwaway cache, and the suite was minting fixture
 * repos into the developer's real one.
 *
 * Registered as a vitest `setupFiles` entry, so it runs once per TEST FILE,
 * before that file is imported, in that file's own worker. Every file therefore
 * starts pointed at a directory only it can name. A test that wants a finer
 * sandbox still overrides `SEORAK_DIR` itself; this is the floor, not a ceiling.
 *
 * It is deliberately a mechanism rather than a convention. Five of the files
 * that reached the shared directory carried a comment promising they did not
 * (`emit-allowlist.test.ts` said it kept "the suite fs-clean" while writing two
 * files into `~/.seorak`), which is what a convention is worth here. The
 * invariant is pinned by `collector-dir-isolation.test.ts`.
 *
 * Note the interaction with the `if (saved === undefined) delete
 * process.env.SEORAK_DIR` restore that twenty files already do: because this
 * runs first, `saved` is this directory rather than `undefined`, so those
 * restores now hand the variable back to an isolated path instead of re-arming
 * the shared default.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/** Assigned at module scope, i.e. before the test file under it is imported, so
 *  a module that resolves a collector path at import time still sees it. */
const isolated = mkdtempSync(join(tmpdir(), "seorak-suite-"));
process.env.SEORAK_DIR = isolated;

afterAll(() => {
  rmSync(isolated, { recursive: true, force: true });
});
