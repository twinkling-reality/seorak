import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Runs once per test FILE, before that file is imported: every file gets its
    // own SEORAK_DIR, so no two files (and no test file and the developer's own
    // running collector) can share state through the `~/.seorak` default.
    // Reasoning and the measurement that forced it:
    // test/support/isolate-collector-dir.ts.
    // The second entry is the same kind of guarantee about a different piece of
    // inherited state: git's own environment variables, which a pre-push hook
    // exports and which beat every `cwd:` in the suite. See that file.
    setupFiles: [
      "./test/support/isolate-collector-dir.ts",
      "./test/support/isolate-git-environment.ts",
    ],
    // Vitest's 5s default is calibrated for tests that compute. Most of this
    // suite instead spawns real git, runs real hook processes, and waits on real
    // atomic writes, so its runtimes track how contended the machine is rather
    // than how much work the code does. Measured on 2026-08-05 on a 12-core
    // machine: the same file took 26s at load 24 and 131s at load 28 with heavy
    // instantaneous contention, a 5x spread with no code change between runs.
    //
    // 60s is therefore a HANG bound, not a performance budget. Every test that
    // used to carry its own override was working around the 5s default rather
    // than asserting a deadline, so those overrides are gone and this is the one
    // place the headroom is set. The two tests whose own runtime exceeds the
    // headroom this buys still override it, and say why at the call site.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
