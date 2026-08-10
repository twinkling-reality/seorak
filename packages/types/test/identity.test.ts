import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKnownTool,
  normalizeToolId,
  projectHues,
  resolveToolIdentity,
  TOOL_IDENTITY,
  toolRegistryProblems,
} from "../src/identity.ts";

// ── Project identity ────────────────────────────────────────────────────────

/**
 * The whole point of hoisting this hash: a repo must be the SAME color in the web
 * sidebar, the phone's eyebrow, and the Projects tab. Golden values pin the
 * derivation so a "harmless" hue tweak can never quietly repaint one surface.
 * If you change these numbers, you are changing every project's color everywhere.
 */
test("project hues are stable — the mark is the same on every surface", () => {
  assert.deepEqual(projectHues("repo-seorak"), {
    baseHue: 123,
    hue2: 162,
    accent: 308,
    x1: 50,
    y1: 16,
    x2: 81,
    y2: 75,
  });
});

test("the same repo id always hashes to the same mark; different ids diverge", () => {
  assert.deepEqual(projectHues("repo-a"), projectHues("repo-a"));
  assert.notDeepEqual(projectHues("repo-a"), projectHues("repo-b"));
});

test("an unlabeled project still gets a stable mark rather than a hole", () => {
  const hues = projectHues("");
  assert.ok(Number.isInteger(hues.baseHue));
  assert.deepEqual(projectHues(""), hues);
});

test("every derived hue is a real angle and every bloom center a real percent", () => {
  for (const id of ["", "a", "repo-seorak", "orsted", "x".repeat(200), "🙂"]) {
    const h = projectHues(id);
    for (const hue of [h.baseHue, h.hue2, h.accent]) {
      assert.ok(hue >= 0 && hue < 360, `hue out of range for "${id}": ${hue}`);
    }
    for (const pct of [h.x1, h.y1, h.x2, h.y2]) {
      assert.ok(pct >= 0 && pct <= 100, `center out of range for "${id}": ${pct}`);
    }
  }
});

// ── Tool identity ───────────────────────────────────────────────────────────

test("the two agents we actually capture carry their own brand hue", () => {
  const claude = resolveToolIdentity("claude-code");
  assert.equal(claude.id, "claude");
  assert.equal(claude.label, "Claude Code");
  assert.equal(claude.brandColor, "#d9773c");
  assert.ok(claude.known);

  const codex = resolveToolIdentity("codex");
  assert.equal(codex.id, "codex");
  assert.equal(codex.label, "Codex");
  assert.equal(codex.brandColor, "#10a37f");
  assert.ok(codex.known);
});

test("every spelling of an agent id reaches the same canon", () => {
  for (const spelling of ["claude-code", "claude_code", "Claude Code", "CLAUDECODE", "claude"]) {
    assert.equal(resolveToolIdentity(spelling).id, "claude", spelling);
  }
  for (const spelling of ["codex", "codex-cli", "Codex CLI", "codex_cli"]) {
    assert.equal(resolveToolIdentity(spelling).id, "codex", spelling);
  }
});

test("an unknown tool is honest about being unknown, but still resolvable", () => {
  const unknown = resolveToolIdentity("some-new-agent");
  assert.equal(unknown.known, false);
  assert.equal(unknown.label, "Some New Agent");
  assert.ok(unknown.brandColor.startsWith("hsl("));
  assert.ok(!isKnownTool("some-new-agent"));
  // Deterministic: the same unknown agent never changes color between renders.
  assert.equal(unknown.brandColor, resolveToolIdentity("some-new-agent").brandColor);
});

test("a null or empty tool id resolves rather than throwing", () => {
  for (const id of [null, undefined, ""]) {
    const resolved = resolveToolIdentity(id);
    assert.equal(resolved.id, "tool");
    assert.equal(resolved.known, false);
  }
  assert.equal(normalizeToolId(null), "");
});

test("no alias or partial match points at a tool that does not exist", () => {
  assert.deepEqual(toolRegistryProblems(), []);
});

test("every registry entry carries a label and a brand hue", () => {
  for (const [id, entry] of Object.entries(TOOL_IDENTITY)) {
    assert.ok(entry.label.trim().length > 0, `${id} has no label`);
    assert.match(entry.brandColor, /^#[0-9a-f]{6}$/i, `${id} brand color is not a hex`);
  }
});
