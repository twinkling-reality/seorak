/**
 * news.ts, the entry card: the one screen the session opens on when it has
 * something to say, and skips entirely when it does not.
 *
 * WHY IT EXISTS AT ALL. The terminal attention design rejected a splash
 * gate, on the grounds that "an element that cannot be false is decoration". That
 * rules out a logo you press through; it does not rule out this. Every card here
 * carries a claim that can be false (a version you are now on, a capture chain
 * that is not installed), and the screen does not exist on a launch where none of
 * them is true. A splash you cannot avoid would still be wrong.
 *
 * WHERE THE MESSAGES COME FROM. `NEWS.md`, shipped inside the package. There is
 * no central Seorak service to broadcast from (every user deploys their own
 * worker), and a CLI that phoned a vendor host for announcements would leak your
 * IP and your working hours from a product whose whole pitch is that nothing
 * leaves your machine. Shipping the notes means they arrive with the upgrade,
 * work offline, and cost nothing to trust.
 */

/** Which true thing the card is on screen to say. */
export type EntryReason = "first-run" | "not-capturing" | "news";

export interface EntryCard {
  reason: EntryReason;
  /** The label beside the message rows in the identity block ("new in 0.3.0"). */
  label: string;
  /** The message itself, one line per point. */
  body: string[];
}

export interface EntryInputs {
  /** The collector version running now, from package.json. */
  version: string;
  /** The version whose notes this machine has already seen; null on a machine
   *  that has never recorded one. */
  lastSeen: string | null;
  /** Raw NEWS.md. Empty string when it could not be read, which costs a note and
   *  never a session. */
  news: string;
  /** What this machine actually captures, resolved by the CLI. Null when no
   *  agent is installed, which is the one setup problem worth interrupting for. */
  watching: string | null;
}

/** A release's notes. */
export interface Release {
  version: string;
  lines: string[];
}

/** Compare dotted numeric versions. Non-numeric parts sort as 0, which keeps a
 *  malformed heading from ordering ahead of a real release. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * parseNews (PURE). `## <version>` headings with `- ` bullets under them. Prose
 * between the headings (the file's own instructions to whoever edits it) is
 * ignored, so the notes file can explain itself without leaking into the UI.
 */
export function parseNews(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const heading = /^##\s+(\S+)\s*$/.exec(line);
    if (heading) {
      current = { version: heading[1]!, lines: [] };
      releases.push(current);
      continue;
    }
    if (current && line.startsWith("- ")) current.lines.push(line.slice(2).trim());
  }
  return releases.filter((r) => r.lines.length > 0);
}

/**
 * entryCard (PURE). What (if anything) the session should open on.
 *
 * Priority: a machine capturing nothing has a broken product and is told so
 * first; otherwise the notes for the versions crossed since last time.
 *
 * THE FIRST-RUN TRAP. An absent `lastSeen` means either a genuinely new install
 * or an existing one that predates this file. Telling them apart matters: the
 * second would otherwise be welcomed to a product they have been using for
 * weeks. `watching` decides it, because hooks installed is proof of an existing
 * user, and an existing user gets the version recorded silently and no card.
 */
export function entryCard(input: EntryInputs): EntryCard | null {
  const firstEver = input.lastSeen === null;

  if (input.watching === null) {
    return {
      reason: firstEver ? "first-run" : "not-capturing",
      label: "start here",
      body: [
        "Seorak watches your Claude Code and Codex sessions and tells you",
        "when one is waiting on you. Nothing is being captured yet.",
        "Run seorak init to set up the hooks.",
      ],
    };
  }

  // An existing install adopting this build has nothing to be told: it gets the
  // version written down (by the caller) and goes straight to the board.
  if (firstEver) return null;

  const fresh = parseNews(input.news).filter(
    (r) => compareVersions(r.version, input.lastSeen!) > 0 && compareVersions(r.version, input.version) <= 0,
  );
  if (fresh.length === 0) return null;

  fresh.sort((a, b) => compareVersions(b.version, a.version));
  return {
    reason: "news",
    label: `new in ${fresh[0]!.version}`,
    body: fresh.flatMap((r) => r.lines),
  };
}
