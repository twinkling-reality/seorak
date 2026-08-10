// project-themes.test.ts — the per-project color contract. The settings write
// path runs a fault-soft, allowlist
// coercer that SILENTLY DROPS unknown fields, so a per-project colour must survive a
// coerce round-trip (else the picker would appear not to persist) AND a corrupt /
// stale / null entry must drop (never fabricate or mis-apply a colour). These pin
// both halves so a future edit can't regress either.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PALETTE_TOKENS,
  PALETTE_HEX,
  isPaletteToken,
  coerceProjectThemes,
  projectColorToken,
  DEFAULT_PROJECT_THEMES,
} from "../src/project-themes.ts";

test("empty / missing / junk all read as the default (no themes)", () => {
  assert.deepEqual(coerceProjectThemes(undefined), DEFAULT_PROJECT_THEMES);
  assert.deepEqual(coerceProjectThemes(null), DEFAULT_PROJECT_THEMES);
  assert.deepEqual(coerceProjectThemes("nope"), DEFAULT_PROJECT_THEMES);
  assert.deepEqual(coerceProjectThemes([]), DEFAULT_PROJECT_THEMES);
  assert.deepEqual(coerceProjectThemes({ byRepo: "bad" }), DEFAULT_PROJECT_THEMES);
});

test("a valid token survives the coerce round-trip (the F2 persistence guard)", () => {
  const stored = { byRepo: { repoA: { color: "indigo" }, repoB: { color: "green" } } };
  const out = coerceProjectThemes(stored);
  assert.equal(out.byRepo.repoA.color, "indigo");
  assert.equal(out.byRepo.repoB.color, "green");
  assert.equal(projectColorToken(out, "repoA"), "indigo");
});

test("an unknown / stale token is dropped, not fabricated", () => {
  const out = coerceProjectThemes({ byRepo: { repoA: { color: "lavender" }, repoB: { color: 7 } } });
  assert.deepEqual(out.byRepo, {});
  assert.equal(projectColorToken(out, "repoA"), null); // honest-empty → surface default
});

test("a null entry un-themes a project (drops it)", () => {
  // The picker clears a colour by patching the entry to null; deep-merge stores the
  // null, and coerce must drop it so the project falls back to its default look.
  const out = coerceProjectThemes({ byRepo: { repoA: null, repoB: { color: "red" } } });
  assert.equal(out.byRepo.repoA, undefined);
  assert.equal(out.byRepo.repoB.color, "red");
});

test("the empty-string repoId (the 'All projects' aggregate) is never themable", () => {
  const out = coerceProjectThemes({ byRepo: { "": { color: "amber" } } });
  assert.deepEqual(out.byRepo, {});
});

test("the palette is the six on-brand tokens, lavender excluded, hex for each", () => {
  assert.deepEqual([...PALETTE_TOKENS], ["pink", "green", "amber", "red", "indigo", "purple"]);
  assert.ok(!(PALETTE_TOKENS as readonly string[]).includes("lavender"));
  for (const t of PALETTE_TOKENS) assert.match(PALETTE_HEX[t], /^#[0-9a-f]{6}$/);
  assert.ok(isPaletteToken("indigo"));
  assert.ok(!isPaletteToken("teal"));
  assert.ok(!isPaletteToken(undefined));
});
