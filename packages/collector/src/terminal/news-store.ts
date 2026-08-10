/**
 * news-store.ts, the IMPURE half of the entry card: reading the shipped notes,
 * the running version, and the version this machine last saw.
 *
 * Split from `news.ts` so the decision ("is there anything to say?") stays pure
 * and unit-testable without a filesystem, and only these four functions touch
 * disk. Every one is best-effort: a missing NEWS.md, an unreadable package.json,
 * or an unwritable state dir costs a NOTE, never a session. That is the same
 * bargain `loadLayout` takes, and for the same reason.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectorPackageRoot } from "../package-layout.ts";
import { lastSeenVersionPath } from "../paths.ts";

let collectorRoot: string | null = null;
try {
  collectorRoot = collectorPackageRoot();
} catch {
  // A malformed partial copy has no trustworthy version or release notes.
}

/** The running collector version from either source or bundled package layout.
 * "0.0.0" when it cannot be read, which simply means no note is ever newer
 * than "seen". */
export function collectorVersion(): string {
  try {
    if (collectorRoot === null) return "0.0.0";
    const pkg = JSON.parse(readFileSync(join(collectorRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The shipped release notes. Empty string when absent, so `parseNews` finds
 *  nothing and the card simply does not appear. */
export function loadNews(): string {
  try {
    if (collectorRoot === null) return "";
    return readFileSync(join(collectorRoot, "NEWS.md"), "utf8");
  } catch {
    return "";
  }
}

/** The version whose notes this machine has already been shown, or null on a
 *  machine that has never recorded one. A blank file reads as null: an empty
 *  marker is not evidence of anything having been seen. */
export function readLastSeenVersion(): string | null {
  try {
    const raw = readFileSync(lastSeenVersionPath(), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  try {
    const path = lastSeenVersionPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${version}\n`, "utf8");
  } catch {
    // Ignore: the note shows again next launch, which is a far smaller cost
    // than failing to open the session over a state file.
  }
}
