import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archivedRepoIds,
  coerceProjectArchive,
  DEFAULT_PROJECT_ARCHIVE,
  isProjectArchived,
} from "../src/project-archive.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("nothing is archived until something is", () => {
  assert.deepEqual(DEFAULT_PROJECT_ARCHIVE, { byRepo: {} });
  assert.deepEqual(coerceProjectArchive(undefined), { byRepo: {} });
  assert.deepEqual(coerceProjectArchive("nonsense"), { byRepo: {} });
  assert.equal(isProjectArchived(DEFAULT_PROJECT_ARCHIVE, A), false);
});

test("a real entry survives the coerce and reads as archived", () => {
  const archive = coerceProjectArchive({ byRepo: { [A]: { archivedAt: "2026-07-27T12:00:00.000Z" } } });
  assert.deepEqual(archive.byRepo[A], { archivedAt: "2026-07-27T12:00:00.000Z" });
  assert.equal(isProjectArchived(archive, A), true);
  assert.equal(isProjectArchived(archive, B), false);
});

// The failure mode has a direction: a dropped entry shows you a project you wanted
// hidden, a fabricated one hides a project you never archived and cannot then find.
// Every ambiguous input therefore resolves to NOT archived.
test("an entry with no usable timestamp is dropped, never stamped with now", () => {
  for (const bad of [null, {}, { archivedAt: "" }, { archivedAt: "whenever" }, { archivedAt: 1 }, 7]) {
    const archive = coerceProjectArchive({ byRepo: { [A]: bad } });
    assert.equal(isProjectArchived(archive, A), false, `expected ${JSON.stringify(bad)} to be dropped`);
  }
});

test("null is the restore patch, because the coerce drops it", () => {
  const archive = coerceProjectArchive({ byRepo: { [A]: null, [B]: { archivedAt: "2026-07-27T12:00:00.000Z" } } });
  assert.deepEqual(Object.keys(archive.byRepo), [B]);
});

// "" is the All-projects aggregate id, not a project. Archiving it would hide the
// cross-project row that daily_cost_cap fires under.
test("the All projects aggregate can never be archived", () => {
  const archive = coerceProjectArchive({ byRepo: { "": { archivedAt: "2026-07-27T12:00:00.000Z" } } });
  assert.deepEqual(archive.byRepo, {});
});

test("archived ids come back most recently put away first", () => {
  const archive = coerceProjectArchive({
    byRepo: {
      [A]: { archivedAt: "2026-07-01T00:00:00.000Z" },
      [B]: { archivedAt: "2026-07-27T00:00:00.000Z" },
    },
  });
  assert.deepEqual(archivedRepoIds(archive), [B, A]);
});
