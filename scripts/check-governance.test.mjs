import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  DCO_INACTIVE,
  MINIMUM_ACK_WINDOW_DAYS,
  PACKAGE_LICENCES,
  REQUIRED_FILES,
  ROOT_LICENCE_NAMES,
  checkGovernance,
  checkRootLicence,
  readCommits,
  rootLicencePolicy,
  verifySignOff,
} from "./check-governance.mjs";
import { gitSync } from "./isolated-git.mjs";
import { holdsPrivateHalf, loadOwnership } from "./open-core-ownership.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const scratch = [];

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/**
 * A throwaway copy of the governance surface: the six required files, the
 * package LICENSE files, and nothing else. Every case below plants ONE violation
 * into a valid fixture, so a failure names the rule under test rather than the
 * six other things a hand-built fixture would also be missing.
 *
 * The grant list is READ from the gate rather than written out here. It was
 * written out here, and when B6 added `packages/dashboard/LICENSE` to the gate's
 * own list this fixture kept copying two files: every case built on it then
 * carried a second, unrelated problem, and four of them failed on a fault nobody
 * planted.
 */
function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "seorak-governance-"));
  scratch.push(root);
  for (const path of REQUIRED_FILES) {
    cpSync(join(REPO_ROOT, path), join(root, path));
  }
  for (const path of PACKAGE_LICENCES) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    cpSync(join(REPO_ROOT, path), join(root, path));
  }
  mutate(root);
  return root;
}

const write = (root, path, body) => writeFileSync(join(root, path), body);
const read = (root, path) =>
  execFileSync("cat", [join(root, path)], { encoding: "utf8" });

function problemsOf(root, options) {
  return checkGovernance(root, options).problems;
}

function assertOneProblem(problems, needle) {
  const matched = problems.filter((problem) => problem.includes(needle));
  assert.equal(
    matched.length,
    1,
    `expected exactly one problem mentioning "${needle}", got:\n${problems.join("\n")}`,
  );
}

describe("the repository itself", () => {
  it("reports the DCO range as out of scope while the policy says unpublished", () => {
    const { notes } = checkGovernance(REPO_ROOT);
    assert.ok(
      notes.some((note) => note.includes("no commit range in scope")),
      `expected the inactive-range note, got:\n${notes.join("\n")}`,
    );
  });

  it("accepts an unmutated fixture, so every case below plants exactly one fault", () => {
    assert.deepEqual(problemsOf(fixture()), []);
  });
});

describe("a root LICENSE, which ADR 005 decision 7 places on exactly one side", () => {
  for (const name of ["LICENSE", "LICENSE.md", "COPYING"]) {
    it(`fails when ${name} appears at the root of the private half`, () => {
      const root = fixture((r) => write(r, name, "Apache License\nVersion 2.0\n"));
      assertOneProblem(problemsOf(root), `${name} exists at the repository root`);
    });
  }

  // The fixture has no ownership map, so `holdsPrivateHalf` answers true and
  // every case above is judged as the private half. That is the safe default
  // and it is asserted rather than assumed, because the cases above are only
  // about the private rule if this holds.
  it("treats a tree with no ownership map as the private half", () => {
    assert.equal(rootLicencePolicy(fixture()), "forbidden");
  });

  // NOT "this repository is the private half". This file ships in the public
  // file set, so it runs in both trees, and an assertion naming one answer is
  // wrong in the other: the assembled public tree reads `required` and was the
  // thing that caught the first draft of this test. What holds in both is that
  // the policy follows the tree rather than a constant, so it is asserted
  // against the same question `holdsPrivateHalf` answers.
  it("derives the policy from the tree it is running in, not from a constant", () => {
    const { manifest } = loadOwnership(REPO_ROOT);
    assert.notEqual(manifest, undefined, "the ownership map must load in either tree");
    const expected = holdsPrivateHalf(manifest, REPO_ROOT) ? "forbidden" : "required";
    assert.equal(rootLicencePolicy(REPO_ROOT), expected);
    // And the run itself agrees with that answer, so the note a reader sees is
    // the one for the tree they are standing in.
    const { notes } = checkGovernance(REPO_ROOT);
    assert.ok(
      notes.some((note) =>
        expected === "forbidden"
          ? note.includes("Root LICENSE: forbidden")
          : note.startsWith("Root LICENSE:") && !note.includes("forbidden"),
      ),
      `expected a root-licence note for the ${expected} policy, got:\n${notes.join("\n")}`,
    );
  });

  // THE DEFECT THIS RULE HAD. `check-governance.mjs` ships in the public file
  // set, where the sentence it used to print ("this repository becomes the
  // PRIVATE seorak-internal repository") is false and the rule it enforced was
  // backwards: decision 7 gives the public repository a root Apache-2.0 grant,
  // so the gate would have gone red the first time somebody added it.
  it("accepts a root LICENSE in the public half rather than failing on it", () => {
    for (const name of ROOT_LICENCE_NAMES) {
      const { problems, note } = checkRootLicence("required", [name]);
      assert.deepEqual(problems, [], `${name} must not be a problem in the public half`);
      assert.match(note, /decision 7 gives the public repository/);
    }
  });

  it("says what still owes the public root grant when it is absent", () => {
    const { problems, note } = checkRootLicence("required", []);
    assert.deepEqual(problems, []);
    assert.match(note, /Root LICENSE: absent/);
    assert.match(note, /phase C/);
  });

  it("still forbids every root licence name in the private half", () => {
    const { problems } = checkRootLicence("forbidden", ROOT_LICENCE_NAMES);
    assert.equal(problems.length, ROOT_LICENCE_NAMES.length);
    // The message a reader gets has to be true where they are standing.
    assert.ok(problems.every((problem) => problem.includes("the private half of the ADR 005 split")));
  });
});

describe("required files", () => {
  for (const path of REQUIRED_FILES) {
    it(`fails when ${path} is missing`, () => {
      const root = fixture((r) => rmSync(join(r, path)));
      assert.ok(
        problemsOf(root).some((problem) => problem.startsWith(path)),
        `expected a problem naming ${path}`,
      );
    });
  }
});

describe("the copyright line", () => {
  it("fails when NOTICE and a package LICENSE disagree", () => {
    const root = fixture((r) => write(r, "NOTICE", "Seorak\nCopyright 2099 Someone Else\n"));
    assertOneProblem(problemsOf(root), "packages/collector/LICENSE does not carry");
    assertOneProblem(problemsOf(root), "packages/types/LICENSE does not carry");
  });

  it("fails when NOTICE carries no copyright line at all", () => {
    const root = fixture((r) => write(r, "NOTICE", "Seorak\n"));
    assertOneProblem(problemsOf(root), "NOTICE carries no");
  });
});

describe("the contact", () => {
  it("fails when a second address appears in one file", () => {
    const root = fixture((r) =>
      write(r, "SECURITY.md", `${read(r, "SECURITY.md")}\n\nAlso mail security@elsewhere.org.\n`),
    );
    assertOneProblem(problemsOf(root), "different contact addresses");
  });

  it("fails when the address is a placeholder", () => {
    const root = fixture((r) =>
      write(r, "TRADEMARK.md", `${read(r, "TRADEMARK.md")}\n\nAsk you@example.com.\n`),
    );
    assert.ok(
      problemsOf(root).some((problem) => problem.includes("is a placeholder")),
      "a placeholder address should be refused by name",
    );
  });

  it("fails when no governance file names an address", () => {
    const root = fixture((r) => {
      for (const path of REQUIRED_FILES) {
        write(r, path, read(r, path).replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "us"));
      }
    });
    assertOneProblem(problemsOf(root), "no governance file names a contact address");
  });
});

describe("the security acknowledgement window", () => {
  it("fails on a window shorter than a maintainer can hold", () => {
    const root = fixture((r) =>
      write(
        r,
        "SECURITY.md",
        read(r, "SECURITY.md").replace(
          /\|\s*Acknowledgement([^|]*)\|\s*\*\*\d+\s*days?\*\*\s*\|/i,
          "| Acknowledgement$1| **1 day** |",
        ),
      ),
    );
    const problems = problemsOf(root);
    assertOneProblem(problems, "promises acknowledgement in 1 days");
    assert.ok(
      problems[0].includes(`${MINIMUM_ACK_WINDOW_DAYS} days`),
      "the failure should name the floor it enforces",
    );
  });

  it("fails on a window so long it is not a commitment", () => {
    const root = fixture((r) =>
      write(
        r,
        "SECURITY.md",
        read(r, "SECURITY.md").replace(
          /\|\s*Acknowledgement([^|]*)\|\s*\*\*\d+\s*days?\*\*\s*\|/i,
          "| Acknowledgement$1| **365 days** |",
        ),
      ),
    );
    assertOneProblem(problemsOf(root), "which is long enough to be no commitment");
  });

  it("fails when the window is removed entirely", () => {
    const root = fixture((r) =>
      write(r, "SECURITY.md", read(r, "SECURITY.md").replaceAll("Acknowledgement", "Reply")),
    );
    assertOneProblem(problemsOf(root), "SECURITY.md states no acknowledgement window");
  });
});

describe("the trademark draft marker", () => {
  it("fails when the draft marker is dropped with no adoption line", () => {
    const root = fixture((r) =>
      write(r, "TRADEMARK.md", read(r, "TRADEMARK.md").replace("DRAFT. NOT IN FORCE.", "In force.")),
    );
    assertOneProblem(problemsOf(root), "TRADEMARK.md is neither marked");
  });

  it("passes when the draft marker is replaced by an explicit adoption line", () => {
    const root = fixture((r) =>
      write(
        r,
        "TRADEMARK.md",
        `${read(r, "TRADEMARK.md").replace("DRAFT. NOT IN FORCE.", "In force.")}\n\nAdopted: 2026-09-01 after review.\n`,
      ),
    );
    assert.deepEqual(problemsOf(root), []);
  });
});

describe("the licensing policy, which the DCO check requires", () => {
  it("fails when the policy is missing", () => {
    const root = fixture((r) => rmSync(join(r, "LICENSING-POLICY.md")));
    assertOneProblem(problemsOf(root), "the DCO check cannot pass without LICENSING-POLICY.md");
  });

  it("fails when the inbound licence is not declared", () => {
    const root = fixture((r) =>
      write(
        r,
        "LICENSING-POLICY.md",
        read(r, "LICENSING-POLICY.md").replace("**Inbound licence:** Apache-2.0", "Inbound: whatever"),
      ),
    );
    assertOneProblem(problemsOf(root), "does not declare `**Inbound licence:** Apache-2.0`");
  });

  it("fails when the certification version is not declared", () => {
    const root = fixture((r) =>
      write(
        r,
        "LICENSING-POLICY.md",
        read(r, "LICENSING-POLICY.md").replace("**Certification:** DCO 1.1", "Certification: a CLA"),
      ),
    );
    assertOneProblem(problemsOf(root), "does not declare `**Certification:** DCO 1.1`");
  });

  it("fails when the enforcement value names a commit that does not exist", () => {
    const root = fixture((r) =>
      write(
        r,
        "LICENSING-POLICY.md",
        read(r, "LICENSING-POLICY.md").replace(
          `Sign-off required from: \`${DCO_INACTIVE}\``,
          "Sign-off required from: `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`",
        ),
      ),
    );
    assertOneProblem(problemsOf(root), "which is not a commit in this repository");
  });
});

// ---------------------------------------------------------------------------
// SIGN-OFF, AGAINST A REAL GIT RANGE
//
// The value in LICENSING-POLICY.md is `unpublished` today, so this repository's
// own run has no commits in scope. That is the honest state and it is also the
// state in which a mechanism quietly rots. These build an actual repository,
// commit into it signed and unsigned, and run the same code path the gate runs.
// ---------------------------------------------------------------------------

function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), "seorak-dco-"));
  scratch.push(root);
  const git = (...args) => gitSync(args, { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test Maintainer");
  git("config", "user.email", "test@localhost.invalid");
  git("config", "commit.gpgsign", "false");
  return { root, git };
}

describe("sign-off over a real range", () => {
  it("accepts every commit when each carries a trailer, and names the unsigned one when it does not", () => {
    const { root, git } = gitRepo();
    writeFileSync(join(root, "a.txt"), "base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: baseline");
    const base = gitSync(["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    writeFileSync(join(root, "b.txt"), "signed\n");
    git("add", "-A");
    git("commit", "-q", "-s", "-m", "feat: a signed contribution");

    assert.deepEqual(verifySignOff(readCommits(root, base)), []);

    writeFileSync(join(root, "c.txt"), "unsigned\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feat: an uncertified contribution");

    const unsigned = verifySignOff(readCommits(root, base));
    assert.equal(unsigned.length, 1);
    assert.equal(unsigned[0].subject, "feat: an uncertified contribution");
  });

  it("survives a commit message that contains blank lines and separator-shaped text", () => {
    const { root, git } = gitRepo();
    writeFileSync(join(root, "a.txt"), "base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: baseline");
    const base = gitSync(["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    writeFileSync(join(root, "b.txt"), "tricky\n");
    git("add", "-A");
    git(
      "commit",
      "-q",
      "-s",
      "-m",
      "feat: a subject",
      "-m",
      "A body with a blank line,\n\nand a line that looks like Signed-off-by: nobody",
    );

    const commits = readCommits(root, base);
    assert.equal(commits.length, 1);
    assert.deepEqual(verifySignOff(commits), []);
  });

  it("rejects a malformed trailer that is not an address", () => {
    assert.equal(
      verifySignOff([{ sha: "0".repeat(40), message: "feat: x\n\nSigned-off-by: Someone\n" }]).length,
      1,
    );
  });

  it("drives the whole gate through an explicit range override", () => {
    const { root, git } = gitRepo();
    for (const path of REQUIRED_FILES) cpSync(join(REPO_ROOT, path), join(root, path));
    for (const path of PACKAGE_LICENCES) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      cpSync(join(REPO_ROOT, path), join(root, path));
    }
    git("add", "-A");
    git("commit", "-q", "-m", "chore: governance baseline");
    const base = gitSync(["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    writeFileSync(join(root, "later.txt"), "later\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feat: uncertified");

    const problems = problemsOf(root, { dcoRange: base });
    assertOneProblem(problems, "has no Signed-off-by trailer");
    assert.ok(
      problems[0].includes("git commit -s"),
      "the failure should tell a contributor how to fix it",
    );
  });
});
