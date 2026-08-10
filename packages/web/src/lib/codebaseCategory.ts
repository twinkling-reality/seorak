import type { FileCategory } from '@seorak/types';

/**
 * FileCategory → validated fill token (tokens.css --viz-cat-*) + display label.
 * Shared by the live files-in-play strip (LiveWidgets) and the codebase category
 * composition (FilesPanel) so the palette and the "other → unclassified" wording
 * live in exactly one place.
 */
export const FILE_CATEGORY_FILL: Record<FileCategory, string> = {
  source: 'var(--viz-cat-source)',
  test: 'var(--viz-cat-test)',
  config: 'var(--viz-cat-config)',
  styles: 'var(--viz-cat-styles)',
  docs: 'var(--viz-cat-docs)',
  data: 'var(--viz-cat-data)',
  other: 'var(--viz-cat-other)',
};

/** The category word as face copy ("other" is a rule miss, so say so plainly). */
export function fileCategoryLabel(category: string): string {
  return category === 'other' ? 'unclassified' : category;
}

/** Fill token for a category, falling back to the neutral "other" token. */
export function fileCategoryFill(category: string): string {
  return FILE_CATEGORY_FILL[category as FileCategory] ?? FILE_CATEGORY_FILL.other;
}
