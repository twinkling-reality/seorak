/**
 * repo-identity.test.ts — the invariants the fragmentation fix depends on.
 *
 * Two halves. The PURE half drives `resolveIdentityPure` with hand-built
 * discriminators + ledger (no fs, no git), pinning the resolution priority, the
 * reuse guard, and the mint provenance. The LOAD half uses a temporary SEORAK_DIR
 * and pins the thing that can actually lose a user's history: a ledger that is
 * present but unusable must be quarantined, not silently replaced, because an
 * empty ledger re-mints `root:`-disambiguated entries and moved-origin repos to
 * DIFFERENT ids. Retired versions take that same quarantine path.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoIdentity } from "../src/git.ts";
import { repoIdentityLedgerPath } from "../src/paths.ts";
import {
  emptyRepoIdentityLedger,
  loadRepoIdentityLedger,
  neverRepoIdsIn,
  type RepoDiscriminators,
  type RepoIdentityEntry,
  REPO_IDENTITY_LEDGER_VERSION,
  resolveIdentityPure,
  saveRepoIdentityLedger,
} from "../src/repo-identity.ts";

const SALT = "test-salt-0123456789abcdef";
/** Injected clock: `resolveIdentityPure` must never read one itself. */
const NOW = 1_760_000_000_000;

/** The LEGACY id recipe (pre-fix repoIdentity), for the zero-rotation assertion. */
function legacyId(seed: string): string {
  return createHash("sha256").update(SALT).update("\0").update(seed).digest("hex");
}

function disc(over: Partial<RepoDiscriminators>): RepoDiscriminators {
  return { isRepo: true, toplevel: null, origin: null, rootKey: null, ...over };
}

describe("resolveIdentityPure", () => {
  it("first sight with an origin mints the LEGACY origin-seeded id (zero rotation)", () => {
    const d = disc({ toplevel: "/Users/me/dev/proj", origin: "github.com/me/proj", rootKey: "rk1" });
    const res = resolveIdentityPure(d, "/Users/me/dev/proj", SALT, emptyRepoIdentityLedger(), NOW);
    expect(res.repoId).toBe(legacyId("github.com/me/proj"));
    expect(res.repoLabel).toBe("proj");
    expect(res.changed).toBe(true);
    expect(res.ledger.entries).toHaveLength(1);
    expect(res.ledger.entries[0]?.rootKey).toBe("rk1");
  });

  it("first sight WITHOUT an origin mints the LEGACY path-seeded id", () => {
    const d = disc({ toplevel: "/Users/me/dev/local", origin: null, rootKey: "rk2" });
    const res = resolveIdentityPure(d, "/Users/me/dev/local", SALT, emptyRepoIdentityLedger(), NOW);
    expect(res.repoId).toBe(legacyId("/Users/me/dev/local"));
  });

  it("survives a git RENAME/transfer: origin changes, root key holds → same id", () => {
    const ledger = emptyRepoIdentityLedger();
    const first = resolveIdentityPure(
      disc({ toplevel: "/dev/1312", origin: "github.com/me/1312", rootKey: "root-abc" }),
      "/dev/1312",
      SALT,
      ledger,
      NOW,
    );
    // Later: repo renamed to 1321 (origin + toplevel changed) — same root commit.
    const second = resolveIdentityPure(
      disc({ toplevel: "/dev/1321", origin: "github.com/me/1321", rootKey: "root-abc" }),
      "/dev/1321",
      SALT,
      first.ledger,
      NOW,
    );
    expect(second.repoId).toBe(first.repoId);
    expect(second.repoLabel).toBe("1321"); // label follows the new basename
    // Both origins + toplevels recorded on the one entry.
    expect(second.ledger.entries).toHaveLength(1);
    expect(second.ledger.entries[0]?.origins).toEqual([
      "github.com/me/1312",
      "github.com/me/1321",
    ]);
  });

  it("survives a MOVE: toplevel changes, root key holds → same id", () => {
    const first = resolveIdentityPure(
      disc({ toplevel: "/Users/me/Desktop/proj", origin: null, rootKey: "root-xyz" }),
      "/Users/me/Desktop/proj",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    const moved = resolveIdentityPure(
      disc({ toplevel: "/Users/me/dev/proj", origin: null, rootKey: "root-xyz" }),
      "/Users/me/dev/proj",
      SALT,
      first.ledger,
      NOW,
    );
    expect(moved.repoId).toBe(first.repoId);
  });

  it("survives iCloud eviction: origin+root unreadable, toplevel holds → same id, flagged degraded", () => {
    const first = resolveIdentityPure(
      disc({ toplevel: "/Desktop/proj", origin: "github.com/me/proj", rootKey: "root-1" }),
      "/Desktop/proj",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    // A later hook fires while .git/config is an iCloud placeholder: origin AND
    // root key come back null, but the toplevel path is unchanged.
    const evicted = resolveIdentityPure(
      disc({ toplevel: "/Desktop/proj", origin: null, rootKey: null }),
      "/Desktop/proj",
      SALT,
      first.ledger,
      NOW,
    );
    expect(evicted.repoId).toBe(first.repoId); // NO silent downgrade to a new path id
    expect(evicted.degraded).toBe(true);
  });

  it("does NOT merge two different repos that reused one path (root keys differ)", () => {
    const first = resolveIdentityPure(
      disc({ toplevel: "/tmp/scratch", origin: null, rootKey: "root-A" }),
      "/tmp/scratch",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    // A DIFFERENT repo later lives at the same path (old deleted, new cloned).
    const different = resolveIdentityPure(
      disc({ toplevel: "/tmp/scratch", origin: null, rootKey: "root-B" }),
      "/tmp/scratch",
      SALT,
      first.ledger,
      NOW,
    );
    expect(different.repoId).not.toBe(first.repoId);
    expect(different.ledger.entries).toHaveLength(2);
  });

  it("is idempotent: re-resolving unchanged discriminators does not mutate the ledger", () => {
    const first = resolveIdentityPure(
      disc({ toplevel: "/dev/p", origin: "o", rootKey: "r" }),
      "/dev/p",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    const again = resolveIdentityPure(
      disc({ toplevel: "/dev/p", origin: "o", rootKey: "r" }),
      "/dev/p",
      SALT,
      first.ledger,
      NOW,
    );
    expect(again.repoId).toBe(first.repoId);
    expect(again.changed).toBe(false);
  });

  it("non-git cwd mints from the cwd and is sticky on repeat", () => {
    const first = resolveIdentityPure(
      disc({ isRepo: false, toplevel: null, origin: null, rootKey: null }),
      "/some/plain/dir",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    expect(first.repoId).toBe(legacyId("/some/plain/dir"));
    expect(first.degraded).toBe(false); // not a git repo => not a degraded git read
    const again = resolveIdentityPure(
      disc({ isRepo: false, toplevel: null, origin: null, rootKey: null }),
      "/some/plain/dir",
      SALT,
      first.ledger,
      NOW,
    );
    expect(again.repoId).toBe(first.repoId);
    expect(again.changed).toBe(false);
  });
});

describe("mint provenance", () => {
  it("records the ORIGIN seed and the injected clock", () => {
    const res = resolveIdentityPure(
      disc({ toplevel: "/dev/a", origin: "github.com/me/a", rootKey: "rk-a" }),
      "/dev/a",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    expect(res.ledger.entries[0]?.mintScheme).toBe("origin");
    expect(res.ledger.entries[0]?.firstSeenAt).toBe(NOW);
  });

  it("records the PATH seed when there is no origin", () => {
    const res = resolveIdentityPure(
      disc({ toplevel: "/dev/b", origin: null, rootKey: "rk-b" }),
      "/dev/b",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    expect(res.ledger.entries[0]?.mintScheme).toBe("path");
  });

  it("records the ROOT-KEY seed when the reuse guard disambiguates a shared path", () => {
    const first = resolveIdentityPure(
      disc({ toplevel: "/tmp/reused", origin: null, rootKey: "root-A" }),
      "/tmp/reused",
      SALT,
      emptyRepoIdentityLedger(),
      NOW,
    );
    const second = resolveIdentityPure(
      disc({ toplevel: "/tmp/reused", origin: null, rootKey: "root-B" }),
      "/tmp/reused",
      SALT,
      first.ledger,
      NOW + 1,
    );
    expect(second.repoId).toBe(legacyId("root:root-B"));
    expect(second.ledger.entries[1]?.mintScheme).toBe("root-key");
    expect(second.ledger.entries[1]?.firstSeenAt).toBe(NOW + 1);
    // The first entry keeps its own provenance; nothing is rewritten.
    expect(second.ledger.entries[0]?.mintScheme).toBe("path");
    expect(second.ledger.entries[0]?.firstSeenAt).toBe(NOW);
  });

  it("does NOT back-fill provenance onto a matched entry that lacks it", () => {
    // Shaped like an entry created before provenance existed.
    const ledger = {
      version: REPO_IDENTITY_LEDGER_VERSION,
      entries: [
        {
          repoId: legacyId("github.com/me/old"),
          repoLabel: "old",
          rootKey: "rk-old",
          origins: ["github.com/me/old"],
          toplevels: ["/dev/old"],
        },
      ],
    };
    const res = resolveIdentityPure(
      disc({ toplevel: "/dev/moved", origin: "github.com/me/old", rootKey: "rk-old" }),
      "/dev/moved",
      SALT,
      ledger,
      NOW,
    );
    expect(res.repoId).toBe(legacyId("github.com/me/old"));
    expect(res.ledger.entries[0]?.mintScheme).toBeUndefined();
    expect(res.ledger.entries[0]?.firstSeenAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Load / quarantine — real files under a temporary SEORAK_DIR.
// ---------------------------------------------------------------------------

function spyWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

const savedDir = process.env.SEORAK_DIR;
let sandbox: string;
let warn: ReturnType<typeof spyWarn>;

function writeLedgerFile(contents: string): string {
  const path = repoIdentityLedgerPath();
  writeFileSync(path, contents, "utf8");
  return path;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-repoid-"));
  process.env.SEORAK_DIR = sandbox;
  warn = spyWarn();
});

afterEach(() => {
  // Restore the spy first: a leaked console spy silences every later test file.
  vi.restoreAllMocks();
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  chmodSync(sandbox, 0o700);
  rmSync(sandbox, { recursive: true, force: true });
});

describe("loadRepoIdentityLedger outcomes", () => {
  it("ABSENT file is a new install: empty ledger, no warning, no quarantine", () => {
    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("absent");
    expect(load.ledger.entries).toEqual([]);
    expect(load.dropped).toBe(0);
    expect(load.quarantinePath).toBeUndefined();
    expect(load.persistable).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(readdirSync(sandbox).filter((f) => f.includes("unusable"))).toEqual([]);
  });

  it("round-trips the current version without rewriting or inventing provenance", () => {
    const entry = {
      repoId: legacyId("github.com/me/current"),
      repoLabel: "current",
      rootKey: "rk-current",
      origins: ["github.com/me/current"],
      toplevels: ["/dev/current"],
      mintScheme: "origin" as const,
      firstSeenAt: NOW,
    };
    const path = writeLedgerFile(
      JSON.stringify({
        version: REPO_IDENTITY_LEDGER_VERSION,
        entries: [entry],
      }),
    );
    const before = readFileSync(path, "utf8");
    const load = loadRepoIdentityLedger();
    expect(load).toMatchObject({
      outcome: "loaded",
      dropped: 0,
      persistable: true,
      ledger: {
        version: REPO_IDENTITY_LEDGER_VERSION,
        entries: [entry],
      },
    });
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("quarantines the retired v1 version instead of importing it", () => {
    const raw = JSON.stringify({
      version: 1,
      entries: [
        {
          repoId: legacyId("github.com/me/retired"),
          repoLabel: "retired",
          origins: ["github.com/me/retired"],
          toplevels: ["/dev/retired"],
        },
      ],
    });
    const path = writeLedgerFile(raw);
    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("unusable");
    expect(load.ledger.entries).toEqual([]);
    expect(readFileSync(load.quarantinePath as string, "utf8")).toBe(raw);
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("CORRUPT file is quarantined byte-for-byte, warns once, and capture still resolves", () => {
    const raw = '{"version": 2, "entries": [ this is not json';
    const path = writeLedgerFile(raw);

    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("unusable");
    expect(load.persistable).toBe(true);
    expect(load.quarantinePath).toBeDefined();
    const quarantined = load.quarantinePath as string;
    // Original bytes survive, under a timestamped sibling name.
    expect(readFileSync(quarantined, "utf8")).toBe(raw);
    expect(basename(quarantined)).toMatch(
      /^repo-identity\.json\.unusable-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
    );
    // The corrupt file was MOVED, never overwritten where it stood.
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain(quarantined);
    expect(message).toContain("re-minted");

    // Fault-soft: resolution continues, and the fresh write leaves the quarantine alone.
    const res = resolveIdentityPure(
      disc({ toplevel: "/dev/x", origin: "github.com/me/x", rootKey: "rk-x" }),
      "/dev/x",
      SALT,
      load.ledger,
      NOW,
    );
    expect(res.repoId).toBe(legacyId("github.com/me/x"));
    saveRepoIdentityLedger(res.ledger);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(REPO_IDENTITY_LEDGER_VERSION);
    expect(readFileSync(quarantined, "utf8")).toBe(raw);
  });

  it("UNRECOGNIZED version takes the same quarantine path (a newer file is not importable)", () => {
    const raw = JSON.stringify({ version: REPO_IDENTITY_LEDGER_VERSION + 1, entries: [] });
    const path = writeLedgerFile(raw);
    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("unusable");
    expect(load.ledger.entries).toEqual([]);
    expect(readFileSync(load.quarantinePath as string, "utf8")).toBe(raw);
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("WRONG top-level shape (entries not an array) is quarantined too", () => {
    const raw = JSON.stringify({ version: REPO_IDENTITY_LEDGER_VERSION, entries: { a: 1 } });
    writeLedgerFile(raw);
    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("unusable");
    expect(readFileSync(load.quarantinePath as string, "utf8")).toBe(raw);
  });

  it("MALFORMED ENTRIES are dropped, counted, and warned about; good entries load", () => {
    const good = {
      repoId: legacyId("github.com/me/keep"),
      repoLabel: "keep",
      rootKey: "rk-keep",
      origins: ["github.com/me/keep"],
      toplevels: ["/dev/keep"],
      mintScheme: "origin" as const,
      firstSeenAt: NOW,
    };
    writeLedgerFile(
      JSON.stringify({
        version: REPO_IDENTITY_LEDGER_VERSION,
        entries: [good, null, { repoLabel: "no-id" }, { repoId: 7, repoLabel: "bad-type" }, "nope"],
      }),
    );
    const load = loadRepoIdentityLedger();
    expect(load.outcome).toBe("loaded");
    expect(load.dropped).toBe(4);
    expect(load.ledger.entries).toEqual([good]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("4");
    // The warning names no repo path, origin url, or id.
    expect(message).not.toContain(good.repoId);
    expect(message).not.toContain("github.com/me/keep");
    expect(message).not.toContain("/dev/keep");
  });

  it("ignores unrecognized provenance values rather than trusting them", () => {
    writeLedgerFile(
      JSON.stringify({
        version: REPO_IDENTITY_LEDGER_VERSION,
        entries: [
          {
            repoId: "id",
            repoLabel: "l",
            origins: [],
            toplevels: ["/dev/l"],
            mintScheme: "made-up",
            firstSeenAt: "yesterday",
          },
        ],
      }),
    );
    const entry = loadRepoIdentityLedger().ledger.entries[0];
    expect(entry?.repoId).toBe("id");
    expect(entry?.mintScheme).toBeUndefined();
    expect(entry?.firstSeenAt).toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)(
    "refuses to persist when an unusable file could NOT be moved aside",
    () => {
      const raw = "{ broken";
      const path = writeLedgerFile(raw);
      chmodSync(sandbox, 0o500); // rename + create both fail in this directory

      const load = loadRepoIdentityLedger();
      expect(load.outcome).toBe("unusable");
      expect(load.persistable).toBe(false);
      expect(load.quarantinePath).toBeUndefined();
      // The only record of the historical ids is untouched, in place.
      expect(readFileSync(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(readdirSync(sandbox).filter((f) => f.includes("unusable"))).toEqual([]);
    },
  );
});

describe("repoIdentity end to end (git.ts call site)", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "seorak-repoid-git-"));
    const g = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    g(["init", "-q", "-b", "main"]);
    g(["config", "user.email", "t@t.t"]);
    g(["config", "user.name", "t"]);
    g(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "a.txt"), "a\n");
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "first"]);
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("resolves an id with a CORRUPT ledger present and rewrites a clean v2 file", () => {
    const path = writeLedgerFile("not json at all");
    const identity = repoIdentity(repo);
    expect(identity).not.toBeNull();
    expect(identity?.repoId).toMatch(/^[0-9a-f]{64}$/);
    const written = JSON.parse(readFileSync(path, "utf8")) as { version: number; entries: [] };
    expect(written.version).toBe(REPO_IDENTITY_LEDGER_VERSION);
    expect(written.entries).toHaveLength(1);
    // Re-resolving the same repo is sticky and does not add a second entry.
    expect(repoIdentity(repo)?.repoId).toBe(identity?.repoId);
    expect(
      (JSON.parse(readFileSync(path, "utf8")) as { entries: unknown[] }).entries,
    ).toHaveLength(1);
  });
});

/**
 * The classifier behind the "Outside a repo" fold. Every case here was taken
 * from a real 36-entry ledger, including the one that makes the rule two
 * anchors instead of one.
 */
describe("neverRepoIdsIn", () => {
  const entry = (over: Partial<RepoIdentityEntry>): RepoIdentityEntry => ({
    repoId: "id",
    repoLabel: "label",
    origins: [],
    toplevels: ["/somewhere"],
    ...over,
  });

  function idsFrom(entries: RepoIdentityEntry[]): Set<string> {
    return neverRepoIdsIn({ version: REPO_IDENTITY_LEDGER_VERSION, entries });
  }

  it("folds an identity that never carried a root key or an origin", () => {
    // A home directory, /tmp, or a folder named after a prompt fragment. The
    // label stands for "named after the person", so it must not BE a person:
    // this package publishes to npm, and the public tree has to read as
    // somebody else's too. The assertion keys on repoId, not on this.
    const ids = idsFrom([entry({ repoId: "home", repoLabel: "user" })]);
    expect([...ids]).toEqual(["home"]);
  });

  it("does NOT fold a repo whose root key was unreadable but has an origin", () => {
    // THE CASE THAT SETS THE RULE. `rootKey` is absent for a non-git dir AND for
    // an empty/shallow/evicted repo, so keying on it alone would file a real
    // project as "not a project" and hide it. Measured: one entry in a real
    // ledger looked exactly like this.
    const ids = idsFrom([
      entry({ repoId: "degraded", origins: ["git@github.com:me/thing"] }),
    ]);
    expect(ids.has("degraded")).toBe(false);
  });

  it("does NOT fold a repo with a root key", () => {
    const ids = idsFrom([entry({ repoId: "real", rootKey: "abc" })]);
    expect(ids.has("real")).toBe(false);
  });

  it("does not fold a repo carrying both anchors", () => {
    const ids = idsFrom([
      entry({ repoId: "both", rootKey: "abc", origins: ["git@github.com:me/thing"] }),
    ]);
    expect(ids.size).toBe(0);
  });

  it("folds nothing when the ledger is empty, so a lost ledger hides no project", () => {
    // buildLocalOverviewOn falls back to this when the ledger is absent or
    // unusable. Showing every directory as its own project is the recoverable
    // failure; hiding a real one is not.
    expect(neverRepoIdsIn(emptyRepoIdentityLedger()).size).toBe(0);
  });
});
