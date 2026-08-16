/**
 * terminal-news.test.ts, the entry card's decision. What matters here is when
 * the screen does NOT appear: it is the one thing on this surface that costs a
 * keypress, so every launch it takes over has to have earned it.
 */
import { describe, expect, it } from "vitest";
import { compareVersions, entryCard, parseNews } from "../src/terminal/news.ts";

const NEWS = `# What's new

Prose that explains the file to whoever edits it. Not a release note.

## 0.3.0

- Press /view to switch forms.
- Cost says "at least" when a model has no public price.

## 0.2.0

- The board became a paragraph.
`;

const WATCHING = "Claude Code and Codex";

describe("parseNews", () => {
  it("reads a heading per release and its bullets, ignoring the file's own prose", () => {
    expect(parseNews(NEWS)).toEqual([
      { version: "0.3.0", lines: ["Press /view to switch forms.", 'Cost says "at least" when a model has no public price.'] },
      { version: "0.2.0", lines: ["The board became a paragraph."] },
    ]);
  });

  it("drops a heading with no bullets rather than showing an empty card", () => {
    expect(parseNews("## 0.4.0\n\n## 0.3.0\n- real\n")).toEqual([{ version: "0.3.0", lines: ["real"] }]);
  });

  it("an absent or unreadable file is simply no releases", () => {
    expect(parseNews("")).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  });

  it("treats a missing or junk part as 0 instead of throwing", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.x", "1.0")).toBe(0);
  });
});

describe("entryCard", () => {
  it("says nothing on an ordinary launch, so the session opens straight onto the board", () => {
    expect(entryCard({ version: "0.3.0", lastSeen: "0.3.0", news: NEWS, watching: WATCHING })).toBeNull();
  });

  it("shows only the releases crossed since last time", () => {
    const card = entryCard({ version: "0.3.0", lastSeen: "0.2.0", news: NEWS, watching: WATCHING })!;
    expect(card.reason).toBe("news");
    expect(card.label).toBe("new in 0.3.0");
    expect(card.body).toEqual(["Press /view to switch forms.", 'Cost says "at least" when a model has no public price.']);
  });

  it("gathers several missed releases, newest first", () => {
    const card = entryCard({ version: "0.3.0", lastSeen: "0.1.0", news: NEWS, watching: WATCHING })!;
    expect(card.body[0]).toBe("Press /view to switch forms.");
    expect(card.body).toContain("The board became a paragraph.");
  });

  it("never shows notes for a version this build is not yet on", () => {
    const card = entryCard({ version: "0.2.0", lastSeen: "0.1.0", news: NEWS, watching: WATCHING })!;
    expect(card.body).toEqual(["The board became a paragraph."]);
  });

  it("a machine capturing NOTHING is told so, ahead of any release note", () => {
    const card = entryCard({ version: "0.3.0", lastSeen: "0.2.0", news: NEWS, watching: null })!;
    // Not "first-run": this machine has seen a version before, so the honest
    // claim is that capture broke or was removed, not that it is new here.
    expect(card.reason).toBe("not-capturing");
    expect(card.body.join(" ")).toContain("seorak setup");
  });

  it("an EXISTING install adopting this build is not welcomed to a product it already uses", () => {
    // No last-seen marker, but hooks are installed: that is an upgrade, not a
    // first run, and greeting it would be a false claim about the reader.
    expect(entryCard({ version: "0.3.0", lastSeen: null, news: NEWS, watching: WATCHING })).toBeNull();
  });

  it("a genuinely new machine gets the setup card", () => {
    const card = entryCard({ version: "0.3.0", lastSeen: null, news: NEWS, watching: null })!;
    expect(card.reason).toBe("first-run");
  });

  it("a lost notes file costs the note, never the session", () => {
    expect(entryCard({ version: "0.3.0", lastSeen: "0.1.0", news: "", watching: WATCHING })).toBeNull();
  });
});
