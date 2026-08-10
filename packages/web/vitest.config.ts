import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The test program, which spans the WHOLE workspace: dashboard suites under
 * `src`, marketing suites under `src/marketing`, and the build-script suites
 * under `scripts`.
 *
 * It needs its own config because the entry split gave `vite.config.ts` a `root`
 * of `dashboard/`, and Vitest reads `vite.config.ts` when nothing else is there.
 * It would then look for tests inside the dashboard's document directory and
 * find none, which is a green run that tested nothing.
 *
 * `environment` stays node. The suites that need a DOM say so with a
 * `// @vitest-environment jsdom` docblock, which is per-file and visible at the
 * top of the file that depends on it.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-dashboard/**"],
    // A HANG bound, not a performance budget, and this suite is the one that
    // forced the rule. Measured 2026-08-08 across 173 files and 1826 tests on 12
    // cores: the worst single test was 1965ms at load average ~20, and 5636ms at
    // load average 91.5 with nothing changed in between. That second run is the
    // failure — `Error: Test timed out in 5000ms` under the pre-push hook on a
    // commit that had just passed.
    //
    // WHY 60_000 AND NOT 30_000, which is the number the one hand-rolled
    // workaround in this workspace picked. The evidence is this suite's own, not
    // another workspace's: worst observed 5636ms, and a spread of 2.87x measured
    // on unchanged code, so one further observed doubling of the worst case is
    // 16.2s. 30_000 survives that once; 60_000 survives it twice. The costs are
    // not symmetric — a bound that is too generous costs latency in reporting a
    // hang, against suite wall times of 5 to 90 seconds, while one that is too
    // tight costs the flaky push this exists to remove — so the bound goes to the
    // generous side.
    //
    // FALSIFIER: if any test's honest work here ever approaches 10s, 60_000 has
    // stopped carrying a six-fold hang margin and must be re-derived rather than
    // inherited.
    //
    // AND ONE THING THAT LOOKS LIKE THE FALSIFIER AND IS NOT. Running four
    // workspace suites CONCURRENTLY on 2026-08-08 took this 12-core machine to a
    // one-minute load average of 663, about 30x oversubscribed; the SettingsView
    // hook failed first and a web test reached the full 60000ms. That is not
    // evidence that 60000 is wrong. The stretch is roughly proportional to the
    // oversubscription, so what it shows is that no wall-clock bound survives
    // unbounded contention. Check what else was running before raising this: the
    // pre-push hook runs its gates strictly sequentially and never creates that
    // condition.
    //
    // The spread is also NOT monotonic in load: load average 97.3 peaked at
    // 2154ms while 91.5 peaked at 5636ms, because instantaneous contention beats
    // the one-minute reading. That is why this is one number rather than a value
    // tuned to a measurement that moves.
    //
    // IT WAS ALREADY BEING PAID FOR BY HAND, AND THAT PAYMENT IS NOW GONE.
    // `src/views/SettingsView/SettingsView.test.jsx` carried
    // `beforeAll(…, 30_000)` around an `await import('./SettingsView.js')`, and
    // that file's per-test durations were flat with no first-test spike as a
    // result. Somebody hit this and bought headroom for one file. This is the
    // same purchase, made once, so the hand-rolled 30_000 was deleted rather
    // than kept: below this bound it would have re-imposed a tighter one on the
    // slowest hook in the suite. `npm run test-timeouts:check` now fails any
    // override below the numbers declared here.
    //
    // The cause is contention against a 5000ms budget, and only that. A cold
    // dynamic import inside a test body contributes — a median 8.7x the median
    // of the rest of its file — but the 5636ms failure was on a synchronous
    // test that is not first in its file, so the import is not the mechanism.
    // There is no shared state between files to look for: no env writes, no
    // spawn, no port binding, no repository writes, and vitest already runs
    // this suite `isolate: true` under `pool: forks`.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
