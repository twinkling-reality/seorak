/**
 * layout.ts, the terminal session's persisted preference: the window the
 * paragraph covers, and the view it is drawn in. Nothing else.
 *
 * It used to be an ordered set of `{id, colSpan}` widget slots, mirroring the
 * web's 12-column grid so a layout could converge across the two surfaces. That
 * went with the grid: prose has no slots to curate, and a terminal is not where
 * anyone wants to arrange a dashboard.
 *
 * The on-disk contract is explicit and bounded. `version` is READ, not merely
 * written: the current version loads, a retired v1/v2 file is imported ONCE and
 * rewritten in place at the current version, and every other shape is rejected
 * with the defaults. The importer deletes its own input, which is what keeps it
 * from becoming an indefinite compatibility reader; the exact condition for
 * deleting the branch itself is stated on `migrateRetired`.
 */
import { isOverviewRangeDays, OVERVIEW_RANGE_DAYS } from "@seorak/types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { terminalLayoutPath } from "../paths.ts";
import type { TerminalLayout, TerminalView } from "./types.ts";

/** Bump when the on-disk shape changes incompatibly. v1 was `widgets: string[]`,
 *  v2 `widgets: {id, colSpan}[]`; v3 drops widgets entirely and is the only shape
 *  `loadLayout` accepts as written. The retired two are imported once and erased
 *  (see `migrateRetired`), not read forever. */
export const TERMINAL_LAYOUT_VERSION = 3;

/** The shapes a retired-file import still understands. Exhaustive by
 *  construction: v3 is the current shape and there was never a v0. */
const RETIRED_VERSIONS = [1, 2];

/** Re-exported from the shared contract rather than re-listed: the board must
 *  never offer a window the worker does not serve, and `@seorak/types` is the
 *  one place both sides can reach (ARCHITECTURE.md, OSS split). */
export const ALLOWED_RANGE_DAYS = OVERVIEW_RANGE_DAYS;
export const DEFAULT_RANGE_DAYS = 7;
export const ALLOWED_VIEWS = ["paragraph", "list", "projects"] as const;
/** Prose leads: it is the form that can carry a caveat inline, and the reason
 *  the surface reads as a product rather than a readout. The list is the opt-in
 *  for scanning. */
export const DEFAULT_VIEW: TerminalView = "paragraph";

interface PersistedLayout {
  version: number;
  rangeDays: number;
  view: TerminalView;
}

export function defaultLayout(): TerminalLayout {
  return { rangeDays: DEFAULT_RANGE_DAYS, view: DEFAULT_VIEW };
}

/** Clamp an arbitrary value to a known view, default paragraph. */
export function clampView(v: unknown): TerminalView {
  return ALLOWED_VIEWS.includes(v as TerminalView) ? (v as TerminalView) : DEFAULT_VIEW;
}

export function setView(layout: TerminalLayout, view: unknown): TerminalLayout {
  return { ...layout, view: clampView(view) };
}

/** Clamp an arbitrary number to the nearest allowed window, default 7. */
export function clampRangeDays(n: unknown): number {
  const v = typeof n === "number" ? n : Number.parseInt(String(n), 10);
  return isOverviewRangeDays(v) ? v : DEFAULT_RANGE_DAYS;
}

/** normalizeLayout (PURE). Clamps the window and the view and ignores every
 *  other key, so no unclamped value can reach the session no matter which
 *  on-disk shape it was read out of. Which shapes are eligible to be read at
 *  all is `loadLayout`'s decision, not this function's. */
export function normalizeLayout(input: { rangeDays?: unknown; view?: unknown }): TerminalLayout {
  return { rangeDays: clampRangeDays(input.rangeDays), view: clampView(input.view) };
}

export function setRangeDays(layout: TerminalLayout, days: unknown): TerminalLayout {
  return { ...layout, rangeDays: clampRangeDays(days) };
}

// ── Disk I/O (guarded) ───────────────────────────────────────────────────────

/**
 * writeAtVersion — the only writer. Atomic (tmp + rename), the same move
 * `repo-identity.ts` and `codex-tailer.ts` make: a crash between the two steps
 * leaves the PREVIOUS whole file, never a half-written one, which matters more
 * here than it looks — a torn file read on the next launch would be rejected,
 * and the preference it was in the middle of preserving would be the thing lost.
 *
 * Best-effort in both directions: mkdir, write, and rename are all inside the
 * catch, so a read-only home directory costs the persistence, not the session.
 * Silent by requirement, not by laziness: this runs under a painted TUI frame,
 * and one line on stdout or stderr corrupts it.
 */
function writeAtVersion(layout: TerminalLayout): void {
  const path = terminalLayoutPath();
  const body: PersistedLayout = {
    version: TERMINAL_LAYOUT_VERSION,
    rangeDays: clampRangeDays(layout.rangeDays),
    view: clampView(layout.view),
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  } catch {
    // Ignore — the in-memory layout still drives the session this run.
  }
}

/**
 * migrateRetired — the BOUNDED ONE-TIME import of a v1 or v2 file.
 *
 * A retired file holds exactly two things that still exist in the current
 * shape: the window, and (v2, and only when the file happens to carry one) the
 * view. Both go through the same clamps as every other read, so a value that
 * was legal under the old shape but is not under this one cannot ride the
 * import in. The widget list is not read at all — it describes a grid that no
 * longer exists. The window is CARRIED ACROSS rather than reset because it is a
 * preference the user chose, and dropping it on a version bump would be data
 * loss wearing a version gate as a costume.
 *
 * One-time by construction rather than by promise: the import rewrites the file
 * at the current version before returning, so after the first load there is no
 * retired shape left on disk for this branch to observe again. If the rewrite
 * fails (read-only state dir) the session still gets the migrated preference and
 * the import simply runs again next launch.
 *
 * DELETE THIS BRANCH (and `RETIRED_VERSIONS`) WHEN this prints `3`:
 *
 *     node -p "JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.seorak/terminal-layout.json','utf8')).version"
 *
 * on the one machine of record — or when that file is absent there, since an
 * absent file is minted at the current version. That single check is complete
 * TODAY because the install set of record is exactly one machine:
 * `packages/collector/package.json` is `private: true` and unpublished, and
 * SETUP.md's "Open questions" still lists distribution as undecided, so the only
 * supported install is a repo clone plus `seorak init`. RE-OPEN this condition if
 * the collector is ever published while writers of v1/v2 are still in the wild:
 * the install set is then no longer one home directory, and the condition has to
 * be restated against a released version floor instead of a local read.
 */
function migrateRetired(parsed: Partial<PersistedLayout>): TerminalLayout {
  const migrated = normalizeLayout({ rangeDays: parsed.rangeDays, view: parsed.view });
  writeAtVersion(migrated);
  return migrated;
}

/**
 * loadLayout — the version gate.
 *
 * The current version loads through the normal clamps. A retired v1/v2 file is
 * imported once (`migrateRetired`). Everything else is REJECTED with the
 * defaults and replaced at the current version, so an unrecognized shape does
 * not sit on disk being re-rejected every launch: replacing is acceptable HERE
 * SPECIFICALLY because the whole file is two clamped preferences — no
 * measurement, no identity, nothing that cannot be re-chosen in one keystroke —
 * and because there is no supported downgrade path that would ever want the old
 * bytes back.
 *
 * The exception is a version NEWER than this build's, which is left on disk
 * untouched and simply not read. That file was written by a collector that knows
 * a shape this one does not, so "unrecognized" there means we are the older
 * reader, not that the file is wrong; checking out an older commit should not
 * silently cost the preference. The session runs on defaults and the newer build
 * finds its file intact. A `/range` or `/view` change during the session still
 * overwrites it — that is the user asking, not a silent reset.
 *
 * Absent or unparseable reads as the defaults and writes nothing: there is no
 * version to classify and no preference to preserve in bytes that do not parse,
 * and the first save of the session replaces them anyway. No path here prints —
 * see `writeAtVersion`.
 */
export function loadLayout(): TerminalLayout {
  const path = terminalLayoutPath();
  if (!existsSync(path)) return defaultLayout();

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return defaultLayout();
  }

  // A JSON primitive or array is a shape with no version, which is the
  // rejection path, not the unparseable one: it parsed, it is just not ours.
  const parsed: Partial<PersistedLayout> =
    raw && typeof raw === "object" ? (raw as Partial<PersistedLayout>) : {};
  const version = parsed.version;

  if (version === TERMINAL_LAYOUT_VERSION) return normalizeLayout(parsed);
  if (typeof version === "number" && RETIRED_VERSIONS.includes(version)) return migrateRetired(parsed);
  if (typeof version === "number" && Number.isInteger(version) && version > TERMINAL_LAYOUT_VERSION) {
    return defaultLayout();
  }

  const fresh = defaultLayout();
  writeAtVersion(fresh);
  return fresh;
}

/** Persist the layout (atomic; a write failure is swallowed — `writeAtVersion`). */
export function saveLayout(layout: TerminalLayout): void {
  writeAtVersion(layout);
}
