/**
 * The permanent behavior pin for the P2-01 split of `git.ts` and `emit.ts`.
 *
 * `fixtures/split-characterization.pin.txt` was recorded by running
 * `support/split-characterization.ts` against the PRE-SPLIT code — extracted read-only
 * with `git archive` into a scratch tree — so it is not a snapshot of what the split
 * code happens to do. It is a snapshot of what the code did BEFORE the split, and this
 * test is the assertion that the split changed none of it.
 *
 * It runs real git against real fixture repos, so it is the slowest file in the suite
 * (~15s). That is the price of pinning 1,232 + 767 lines of split behavior on real
 * measurements rather than on mocks, and it is the reason the pin can be trusted.
 *
 * If this fails, the split (or a later edit to either layer) changed observable
 * behavior. The diff names the exact scenario.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { buildFixtures, canonicalize, characterize } from "./support/split-characterization.ts";

const root = mkdtempSync(join(tmpdir(), "seorak-characterization-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const PIN = readFileSync(
  new URL("./fixtures/split-characterization.pin.txt", import.meta.url),
  "utf8",
);

describe("git.ts + emit.ts split characterization", () => {
  it("reproduces the pre-split recording byte for byte", () => {
    const fixtures = buildFixtures(join(root, "fixtures"));
    const actual = canonicalize(characterize(fixtures, join(root, "sandbox")));

    // Compare line by line first: on a failure that names the scenario, which is the
    // whole point of a characterization snapshot. A whole-string compare would print
    // 1,298 lines and name nothing.
    const expectedLines = PIN.split("\n");
    const actualLines = actual.split("\n");
    const firstDivergence = expectedLines.findIndex((line, i) => actualLines[i] !== line);
    expect(
      firstDivergence === -1
        ? null
        : {
            line: firstDivergence + 1,
            expected: expectedLines[firstDivergence],
            actual: actualLines[firstDivergence],
          },
    ).toBeNull();
    expect(actualLines).toHaveLength(expectedLines.length);
    expect(actual).toBe(PIN);
    // 600s, deliberately, against a body measured on 2026-08-05 (12-core machine)
    // at 26s alone on a quiet machine, 51s at load 45, 89s inside the full suite
    // at load 68, and 131s alone at load 28 with heavy instantaneous contention.
    // That is a 5x spread with no code change, because the cost is 2,569
    // SEQUENTIAL `git` process spawns (counted with a PATH shim) and process
    // spawn is the first thing a contended machine makes expensive. 600s is 4.5x
    // the worst run measured.
    //
    // The work is not reducible without destroying what the pin is worth: the
    // snapshot was recorded against PRE-SPLIT code, so a smaller matrix would
    // have to be re-recorded, and the test below deliberately pins coverage
    // floors so it cannot be quietly shrunk either.
    //
    // Note that this timeout cannot INTERRUPT anything: characterize() is fully
    // synchronous, so it blocks the event loop and vitest's timer only fires
    // after it returns. That is why the 60s this replaces reported failures at
    // 89s and 131s rather than at 60s. The timeout's only real job here is to
    // bound a true hang, so a generous value costs nothing and a tight one buys
    // nothing but red.
  }, 600_000);

  it("pins a snapshot that actually covers both layers", () => {
    // A pin that had quietly stopped exercising a layer would still pass the assertion
    // above forever. These are the floors: the scenario counts and the presence of the
    // outcomes that only a real git repo and a real refusal can produce.
    expect(PIN.split("\n").length).toBeGreaterThan(1_000);
    for (const section of [
      "## git: gitContext across every precedence branch",
      "## git: captureMomentum + the ignore-glob compiler through it",
      "## git: writeSessionStartGit + captureSessionDelta",
      "## git: commitsSince",
      "## git: blameAttributedLines + captureAttributedSurvival",
      "## emit: assertEmitSafe verdicts",
      "## emit: session.linesurvival deep validation",
      "## emit: agent.quota deep validation",
    ]) {
      expect(PIN, `pin must still cover ${section}`).toContain(section);
    }
    // Every line-survival fate is reachable in the fixtures, not just the happy one.
    for (const fate of ["retained", "overwritten", "unreachable", "unknown"]) {
      expect(PIN, `pin must reach fate ${fate}`).toContain(`"fate":"${fate}"`);
    }
    // The emit half must record both acceptances and refusals, in bulk.
    const ok = PIN.split("\n").filter((l) => l.endsWith(" = ok")).length;
    const refused = PIN.split("\n").filter((l) => l.includes("EmitAllowlistError:")).length;
    expect(ok).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(300);
  });
});
