/**
 * The suite-wide guarantee that no test file inherits somebody else's git.
 *
 * Git exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_CONFIG_*`
 * into every hook it runs, and those BEAT a child process's `cwd:`. This
 * repository's pre-push hook runs the gate set, the gate set runs the `Test`
 * step, and the `Test` step runs this suite — so inside a push, every fixture
 * repository these files build was being built in, and read from, the
 * DEVELOPER'S repository instead of the temporary directory that was passed.
 *
 * MEASURED 2026-08-08, on a real `git push` to main. Seven `commit-watcher`
 * tests failed with `Command failed: git add -A`; `build-git-fixtures.sh` failed
 * with `remote origin already exists`; and `split-characterization` read the
 * developer's own history where it meant the fixture's, so `commitsBetween` and
 * `commitsSince` answered `null` and `[]` against shas from the wrong
 * repository. The whole `Test` gate exited 1 and the push was refused, while
 * `npm run test` on the same tree was green. A suite that passes at the terminal
 * and fails inside a hook reads as flakiness; it was not.
 *
 * Registered as a vitest `setupFiles` entry beside `isolate-collector-dir.ts`,
 * which exists for the same class of reason: state the suite inherits rather
 * than owns. This is the right layer for it. The alternative was an `env:`
 * argument at every `execFileSync` in the suite — four files and eight call
 * sites when this was written — which is a rule to remember at every new call
 * rather than a property of the run, and `build-git-fixtures.sh` is a shell
 * script that would need its own copy.
 *
 * It deletes the variables from `process.env` itself, so every child a test
 * spawns inherits the scrubbed copy without asking, including that shell script.
 * A test that MEANS a git variable still sets it explicitly per call —
 * `survival.test.ts` pins commit dates with `GIT_AUTHOR_DATE` and is unaffected,
 * because an inherited value is a wrong answer and an asked-for one is the
 * caller saying what it means.
 */
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}
