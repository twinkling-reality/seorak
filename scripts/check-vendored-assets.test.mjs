import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  MANIFEST_PATH,
  analyzeVendoredAssets,
  digestOf,
  loadManifest,
} from "./check-vendored-assets.mjs";
import { REPO_ROOT, trackedFiles } from "./open-core-ownership.mjs";

const paths = trackedFiles(REPO_ROOT);

/**
 * The stack-icon collection, BY ID. Three cases below assert on its own resync
 * command and its own id, and they addressed `collections[0]` until B5 inserted
 * two font collections ahead of it and they started asserting about Figtree.
 */
function stackCollection(manifest) {
  return manifest.collections.find((entry) => entry.id === "simple-icons-stack");
}


/** Mirrors the reader the executable installs: absent is undefined, not a throw. */
const readFile = (path) => {
  const absolute = resolve(REPO_ROOT, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
};

/** The real manifest, deep-copied so a case can bend one field of it. */
function manifestWith(mutate = () => {}) {
  const { manifest, problems } = loadManifest(REPO_ROOT);
  assert.deepEqual(problems, [], "the repository's own manifest should load clean");
  const copy = structuredClone(manifest);
  mutate(copy);
  return copy;
}

const run = (manifest, pathList = paths) =>
  analyzeVendoredAssets(manifest, pathList, REPO_ROOT, readFile).problems;

function assertProblem(problems, needle) {
  assert.ok(
    problems.some((problem) => problem.includes(needle)),
    `expected a problem mentioning "${needle}", got:\n${problems.join("\n") || "(none)"}`,
  );
}

describe("the repository itself", () => {

  it("carries no vendored AI-tool mark under the asset root", () => {
    // B7 deleted thirteen third-party marks from here. What must hold is that
    // every SVG left at the top level is declared ORIGINAL WORK, which is the
    // property rather than the file list: the list was written out and would
    // have to be edited in the public repository, where the four brand files
    // are absent by construction and only the neutral dashboard icon remains.
    const marks = paths.filter((path) => /^packages\/web\/public\/assets\/[^/]+\.svg$/.test(path));
    const { manifest } = loadManifest(REPO_ROOT);
    const original = new Set(manifest.original.map((entry) => entry.path));
    assert.ok(marks.length > 0, "the asset root should still hold this repository's own marks");
    for (const mark of marks) {
      assert.ok(
        original.has(mark),
        `${mark} sits at the top level of the asset root and is not declared original work`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// THE DIGEST IS THE POINT. Before it existed, `Simple Icons v15.0.0` was a
// sentence in a markdown file that no edit to any icon could falsify. These
// prove an edit, an addition, and a removal each do.
// ---------------------------------------------------------------------------

describe("the digest", () => {
  const stack = paths.filter((path) => path.startsWith("packages/web/public/assets/stack/"));

  it("fails when a vendored file's bytes change", () => {
    // Simulated by declaring a digest the tree does not produce, which is what
    // an edited icon looks like from the gate's side.
    const manifest = manifestWith((m) => {
      stackCollection(m).digest = `sha256:${"0".repeat(64)}`;
    });
    const problems = run(manifest);
    assertProblem(problems, "does not match its recorded digest");
    assertProblem(problems, "node packages/web/scripts/sync-stack-icons.mjs");
  });

  it("changes when any single file's content changes", () => {
    const real = digestOf(REPO_ROOT, stack);
    const withOneFewer = digestOf(REPO_ROOT, stack.slice(1));
    assert.notEqual(real, withOneFewer, "removing a file must change the digest");
  });

  it("is independent of the order the file list arrives in", () => {
    assert.equal(digestOf(REPO_ROOT, stack), digestOf(REPO_ROOT, [...stack].reverse()));
  });

  it("fails when a file is added to a collection, before the digest is even recomputed", () => {
    const planted = [...paths, "packages/web/public/assets/stack/languages/planted.svg"];
    const manifest = manifestWith();
    // fileCount is checked first and independently, so an addition is named
    // even when someone remembers to refresh the digest and not the count.
    assertProblem(run(manifest, planted), "declares 72 files and packages/web/public/assets/stack holds 73");
  });
});

describe("declaration", () => {
  it("fails on a file under the root that nothing declares", () => {
    const planted = [...paths, "packages/web/public/assets/newtool.svg"];
    assertProblem(
      run(manifestWith(), planted),
      "packages/web/public/assets/newtool.svg is under a vendored-asset root and is declared nowhere",
    );
  });

  it("tells the author which of the two kinds of entry to add", () => {
    const planted = [...paths, "packages/web/public/assets/newtool.svg"];
    const problem = run(manifestWith(), planted).find((entry) => entry.includes("newtool.svg"));
    assert.ok(problem.includes("a collection entry"));
    assert.ok(problem.includes("an original entry"));
  });

  it("fails when an original entry outlives its file", () => {
    const manifest = manifestWith((m) => {
      m.original.push({ path: "packages/web/public/assets/gone.svg", why: "stale" });
    });
    assertProblem(run(manifest), "is declared original work and is not in the tree");
  });

  it("fails when a collection root holds nothing", () => {
    const manifest = manifestWith((m) => {
      m.collections[0].root = "packages/web/public/assets/nowhere";
    });
    assertProblem(run(manifest), "which holds no tracked file");
  });
});

// ---------------------------------------------------------------------------
// The notices file is what a human reads and the manifest is what the gate
// reads. Two copies of one fact drift; this is what makes them fail instead.
// ---------------------------------------------------------------------------

describe("the notices file", () => {
  it("fails when the recorded version is not the one the notice states", () => {
    const manifest = manifestWith((m) => {
      stackCollection(m).version = "99.0.0";
    });
    assertProblem(run(manifest), "does not record simple-icons-stack's version (99.0.0)");
  });

  it("fails when the recorded sync date is not the one the notice states", () => {
    const manifest = manifestWith((m) => {
      stackCollection(m).syncedOn = "2020-01-01";
    });
    assertProblem(run(manifest), "does not record simple-icons-stack's syncedOn (2020-01-01)");
  });

  it("fails when the named notices file does not exist", () => {
    const manifest = manifestWith((m) => {
      m.collections[0].notices = "packages/web/NO_SUCH_NOTICES.md";
    });
    assertProblem(run(manifest), "which does not exist");
  });
});

describe("the manifest's own shape", () => {
  const cases = [
    ["a missing upstream", (m) => delete m.collections[0].upstream, "is missing upstream"],
    ["a missing version", (m) => delete m.collections[0].version, "is missing version"],
    ["a missing licence", (m) => delete m.collections[0].license, "is missing license"],
    ["a missing resync command", (m) => delete m.collections[0].resync, "is missing resync"],
    [
      "a missing upstream-verification date",
      (m) => delete m.collections[0].verifiedAgainstUpstreamOn,
      "is missing verifiedAgainstUpstreamOn",
    ],
    [
      "a malformed sync date",
      (m) => {
        m.collections[0].syncedOn = "last summer";
      },
      "has a malformed syncedOn",
    ],
    ["a missing digest", (m) => delete m.collections[0].digest, "has no sha256 digest"],
    [
      "a digest that is not sha256",
      (m) => {
        m.collections[0].digest = "md5:whatever";
      },
      "has no sha256 digest",
    ],
    ["a missing file count", (m) => delete m.collections[0].fileCount, "declares no integer fileCount"],
  ];

  // The loader validates before anything is analyzed, so these are asserted
  // through it rather than through analyze: a manifest that does not say where
  // a file came from is not a manifest with one bad field, it is not a record.
  for (const [name, mutate, needle] of cases) {
    it(`refuses ${name}`, () => {
      const { manifest, problems } = loadManifest(REPO_ROOT);
      assert.deepEqual(problems, []);
      const copy = structuredClone(manifest);
      mutate(copy);
      const rejected = validateThrough(copy);
      assertProblem(rejected, needle);
    });
  }

  /**
   * `loadManifest` reads from disk, so shape cases go through the same
   * validation by writing the mutated document to a scratch root. Keeping the
   * validation in one place is the point: a second copy of these rules inside
   * the test would be the exact defect `one-public-file-set.test.mjs` exists to
   * prevent, one directory over.
   */
  function validateThrough(document) {
    const root = mkdtempSync(join(tmpdir(), "seorak-vendored-"));
    try {
      mkdirSync(join(root, "docs/reference"), { recursive: true });
      writeFileSync(join(root, MANIFEST_PATH), JSON.stringify(document, null, 2));
      return loadManifest(root).problems;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
