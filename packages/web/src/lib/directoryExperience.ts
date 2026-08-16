/**
 * Temporary product gate for the unfinished public Directory experience.
 *
 * Keep the implementation and publication foundations intact behind this one
 * default-off switch. Restoring the experience requires its launch review,
 * regression suite, and the independent public-directory read gate to move in
 * the same approved change.
 */
export const DIRECTORY_EXPERIENCE_ENABLED = false;

export const DIRECTORY_PRODUCT_NOTE_PATH = '/blog/private-record-public-identity';

export function isDirectoryExperiencePath(path: string): boolean {
  return (
    path === '/developers' ||
    path === '/docs' ||
    path.startsWith('/docs/') ||
    path.startsWith('/@/') ||
    path === DIRECTORY_PRODUCT_NOTE_PATH
  );
}
