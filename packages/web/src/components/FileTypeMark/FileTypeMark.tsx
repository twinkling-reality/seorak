import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { fileTypeIconPath } from '../../lib/fileTypeIcon.js';
import { fileCategoryFill } from '../../lib/codebaseCategory.js';
import styles from './FileTypeMark.module.css';

interface Props {
  /** The real filename to derive the type icon from (path-stripped). Pass the
   *  raw label, not a hashed-id fallback: a file with no readable name has no
   *  known type and should show the neutral glyph. */
  label: string | null | undefined;
  /** Collector file category. Colors the icon and its wash so the mark still
   *  carries the category (paired with the Kind column). Neutral when absent. */
  category?: string | null;
  className?: string;
}

/**
 * A small file-TYPE mark: the file's recognizable type icon (the TypeScript
 * square, the Markdown mark, the database cylinder for SQL, and so on) filled
 * with the collector category color, on a soft category wash. The SHAPE names
 * the type; the COLOR names the category, so color is never the only signal (the
 * shape stands on its own, and a paired Kind column still carries the category
 * word). A name with no known extension shows a neutral document glyph rather
 * than inventing a type.
 */
export default function FileTypeMark({ label, category, className }: Props) {
  const path = fileTypeIconPath(label);
  const fill = fileCategoryFill(category ?? 'other');
  return (
    <span
      className={clsx(styles.mark, className)}
      style={{ '--ft': fill } as CSSProperties}
      aria-hidden="true"
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        {path ? (
          <path d={path} fill="currentColor" />
        ) : (
          <>
            <path
              d="M6 2.6h7.2L19 8.4v12a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V4A1.4 1.4 0 0 1 6 2.6z"
              fill="currentColor"
              opacity="0.35"
            />
            <path d="M13.2 2.6 19 8.4h-4.4A1.4 1.4 0 0 1 13.2 7z" fill="currentColor" opacity="0.7" />
          </>
        )}
      </svg>
    </span>
  );
}
