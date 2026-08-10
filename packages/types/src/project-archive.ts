/**
 * project-archive.ts — the "I do not work on this any more" contract: the family
 * that lets a repo stop appearing in the lists without pretending it never
 * happened. Keyed by the salted repoId, like every other per-project family.
 *
 * WHY IT IS NOT A DELETE. A project list is fed by `/overview` rollups, which are
 * built from events that really occurred. A repo you deleted off the disk last
 * month still has last month's sessions, cost and tokens in it. Archiving is
 * therefore a VIEW decision, never a data one: the row leaves the lists, and every
 * number it already contributed stays in the portfolio totals, the history and the
 * replay. The alternative — dropping it from the rollups too — would let tidying a
 * list quietly rewrite what you spent, which is the one thing this product exists
 * not to do. Surfaces that hide archived rows are expected to SAY that totals still
 * include them, rather than leaving a gap the reader has to notice.
 *
 * Consequently this family, unlike `projectMerges`, does NOT change any aggregate
 * and so must not bump the overview version: nothing on the read path moves.
 *
 * Shape: `byRepo` maps repoId → { archivedAt }. Present means archived; the
 * timestamp is there so a surface can order the archived list by when you put it
 * away and say so honestly, rather than showing an undated pile. Absent means
 * active (honest-empty: no project is hidden until you hide it), so patching an
 * entry to null is the "restore" and `coerceProjectArchive` drops it on the way out.
 *
 * Fault-soft like every settings family: an entry with no usable timestamp, or
 * keyed by the "All projects" aggregate id "", is DROPPED — a corrupt row can hide
 * a project you never archived, and a hidden project you cannot find is worse than
 * a visible one you did not want.
 */

/** One archived project. v1 is just the moment; the wrapper leaves room for a
 *  reason or a retention rule later without another settings family. */
export interface ProjectArchiveEntry {
  /** When it was archived, ISO-8601. Never fabricated — an entry that arrives
   *  without a parseable one is dropped rather than stamped with "now". */
  archivedAt: string;
}

export interface ProjectArchive {
  /** repoId → entry. Empty by default: nothing is hidden until you hide it. */
  byRepo: Record<string, ProjectArchiveEntry>;
}

export const DEFAULT_PROJECT_ARCHIVE: ProjectArchive = { byRepo: {} };

/**
 * Coerce an unknown (stored row, request body, fetched JSON) into a full
 * ProjectArchive. Allowlist-based and fault-soft, mirroring `coerceProjectThemes`:
 * an entry without a parseable `archivedAt` is DROPPED, so a null "restore" patch
 * and a corrupt blob both resolve to "not archived" — the state that shows you MORE
 * rather than less. The map stays sparse and only ever carries real choices.
 *
 * The repoId is NOT required to look salted, deliberately, and this is where it
 * diverges from `coerceProjectMerges`. A wrong merge conflates two real projects
 * and is hard to notice; a wrong archive hides one row and is undone by restoring
 * it. Strictness there buys safety, and here it would only turn an unusual repoId
 * into a control that silently does nothing.
 */
export function coerceProjectArchive(raw: unknown): ProjectArchive {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawByRepo =
    obj.byRepo && typeof obj.byRepo === "object" && !Array.isArray(obj.byRepo)
      ? (obj.byRepo as Record<string, unknown>)
      : {};
  const byRepo: Record<string, ProjectArchiveEntry> = {};
  for (const [repoId, value] of Object.entries(rawByRepo)) {
    // The "All projects" aggregate is not a project and can never be put away.
    if (repoId.length === 0) continue;
    const archivedAt = value && typeof value === "object" ? (value as Record<string, unknown>).archivedAt : undefined;
    if (typeof archivedAt !== "string" || archivedAt.length === 0) continue;
    if (!Number.isFinite(Date.parse(archivedAt))) continue;
    byRepo[repoId] = { archivedAt };
  }
  return { byRepo };
}

/** The one resolver every surface consults. Never throws, never fabricates. */
export function isProjectArchived(archive: ProjectArchive, repoId: string): boolean {
  return archive.byRepo[repoId] !== undefined;
}

/** The archived repoIds, most recently put away FIRST — the order the restore list
 *  wants, because the thing you archived by mistake is the thing you just archived. */
export function archivedRepoIds(archive: ProjectArchive): string[] {
  return Object.entries(archive.byRepo)
    .sort((a, b) => Date.parse(b[1].archivedAt) - Date.parse(a[1].archivedAt))
    .map(([repoId]) => repoId);
}
