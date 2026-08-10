/**
 * File-TYPE identity derived from a filename. The live files-in-play strip and
 * the codebase files panel both mark a file by its extension (a recognizable
 * type icon, not a bare dot), so the parse lives in exactly one place. The
 * extension keys the icon in fileTypeIcon.ts.
 */

/**
 * Lowercased extension of a filename, path-stripped. Returns '' when there is
 * no usable type extension: a bare name ("Makefile"), or a leading-dot dotfile
 * (".gitignore") whose whole name is the "extension". A compound name keeps
 * only its final segment ("overview.test.ts" -> "ts").
 */
export function fileExtension(label: string | null | undefined): string {
  if (!label) return '';
  const name = label.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}
